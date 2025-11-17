import { NextResponse } from 'next/server';
import { twiml } from 'twilio';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@vercel/kv';

import { TUTOR_SYSTEM_PROMPT } from '@/app/lib/tutor-system';

// Create the KV client (uses UPSTASH_ env vars)
const kv = createClient({
  url: process.env.KV_REDIS_REST_URL,
  token: process.env.KV_REDIS_REST_TOKEN,
});

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

// --- Our main function (no changes) ---
export async function POST(request) {
  try {
    const formData = await request.formData();
    const mediaUrl = formData.get('MediaUrl0');
    const mediaType = formData.get('MediaContentType0');
    const userText = formData.get('Body') || '';
    const userPhone = formData.get('From'); // e.g., 'whatsapp:+1234567890'

    const historyKey = `chat_${userPhone}`;
    let conversationHistory = await kv.get(historyKey) || [];

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // --- THIS IS THE FIX ---
    // Switching back to the 'flash' model (fast and should be available now)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); 
    // --- END OF FIX ---

    const chat = model.startChat({
      history: conversationHistory,
      systemInstruction: {
        role: "system",
        parts: [{ text: TUTOR_SYSTEM_PROMPT }]
      },
    });

    let userMessage;
    if (mediaUrl) {
      console.log(`Analyzing image from: ${mediaUrl}`);
      const imagePart = await imageToBuffer(mediaUrl, mediaType);
      userMessage = [userText, imagePart]; 
    } else {
      console.log(`Analyzing text question: ${userText}`);
      userMessage = userText;
    }

    let replyText = "Sorry, I had a little trouble with that. Can you try again?";
    try {
      const result = await chat.sendMessage(userMessage);
      const response = await result.response;
      replyText = response.text();

      const userMessageForHistory = { role: "user", parts: [{ text: userText }] };
      if(mediaUrl) userMessageForHistory.parts.push({ text: "[User sent an image]" });
      
      const botReplyForHistory = { role: "model", parts: [{ text: replyText }] };

      const updatedHistory = [
        ...conversationHistory,
        userMessageForHistory,
        botReplyForHistory
      ];
      
      await kv.set(historyKey, updatedHistory, { ex: 86400 });

    } catch (aiError) {
      console.error("Gemini AI Error:", aiError);
      console.error(aiError); 
      replyText = "Sorry, I had a little trouble analyzing that image. Can you try sending it again?";
    }
    
    const messagingResponse = new twiml.MessagingResponse();
    messagingResponse.message(replyText);
    const twimlResponse = messagingResponse.toString();

    return new NextResponse(twimlResponse, {
      headers: { 'Content-Type': 'text/xml' },
    });

  } catch (error) {
    console.error("Main POST Error:", error);
    console.error(error);
    return new NextResponse('Error processing message', { status: 500 });
  }
}