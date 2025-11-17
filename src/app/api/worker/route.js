import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { kv } from '@vercel/kv';
import { Twilio } from 'twilio'; // We need the full Twilio library

import { TUTOR_SYSTEM_PROMPT } from '@/app/lib/tutor-system';

// --- Initialize clients (outside the handler) ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const twilioClient = new Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const twilioWhatsAppNumber = 'whatsapp:+14155238886'; // Your Twilio Sandbox Number

// --- Our authenticated image fetch function (no changes) ---
async function imageToBuffer(url, mimeType) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const response = await fetch(url, { headers: { 'Authorization': authHeader } });
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Twilio fetch failed: ${response.status} ${response.statusText}`, errorBody);
    throw new Error(`Failed to fetch image from Twilio: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return {
    inlineData: {
      data: Buffer.from(arrayBuffer).toString('base64'),
      mimeType: mimeType || 'image/jpeg',
    },
  };
}

// --- This is the main worker function ---
// It will be triggered by a "Cron Job" every 10 seconds
export async function GET(request) {
  // Check for a security key to prevent abuse
  const cronSecure = request.headers.get('authorization');
  if (cronSecure !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // --- 1. PULL FROM QUEUE ---
    // Pull the next message from our queue
    const messagePayloadJSON = await kv.rpop('tutor_queue');
    
    if (!messagePayloadJSON) {
      return NextResponse.json({ success: true, message: 'Queue empty' });
    }
    
    const messagePayload = JSON.parse(messagePayloadJSON);
    const { from: userPhone, body: userText, mediaUrl, mediaType } = messagePayload;
    
    console.log(`Working on message from: ${userPhone}`);

    // --- 2. LOAD MEMORY ---
    const historyKey = `chat_${userPhone}`;
    let conversationHistory = await kv.get(historyKey) || [];

    // --- 3. RUN AI (The slow part) ---
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    const chat = model.startChat({
      history: conversationHistory,
      systemInstruction: {
        role: "system",
        parts: [{ text: TUTOR_SYSTEM_PROMPT }]
      },
    });

    // Prepare the message for Gemini
    let userMessage;
    if (mediaUrl) {
      const imagePart = await imageToBuffer(mediaUrl, mediaType);
      userMessage = [userText, imagePart]; 
    } else {
      userMessage = userText;
    }

    // Get the AI's reply
    const result = await chat.sendMessage(userMessage);
    const response = await result.response;
    const replyText = response.text();

    // --- 4. SAVE MEMORY ---
    const userMessageForHistory = { role: "user", parts: [{ text: userText }] };
    if(mediaUrl) userMessageForHistory.parts.push({ text: "[User sent an image]" });
    const botReplyForHistory = { role: "model", parts: [{ text: replyText }] };
    const updatedHistory = [...conversationHistory, userMessageForHistory, botReplyForHistory];
    await kv.set(historyKey, updatedHistory, { ex: 86400 });

    // --- 5. SEND REPLY VIA TWILIO API ---
    // This sends the *real* answer back to the user
    await twilioClient.messages.create({
      from: twilioWhatsAppNumber,
      body: replyText,
      to: userPhone
    });
    
    console.log(`Successfully sent reply to ${userPhone}`);
    return NextResponse.json({ success: true, message: `Processed: ${userPhone}` });

  } catch (error) {
    console.error("Worker Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}