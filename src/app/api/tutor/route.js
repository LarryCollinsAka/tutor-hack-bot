import { NextResponse } from 'next/server';
import { twiml } from 'twilio';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { kv } from '@vercel/kv';

import { TUTOR_SYSTEM_PROMPT } from '@/app/lib/tutor-system';

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

// --- Our new main function ---
export async function POST(request) {
  try {
    const formData = await request.formData();
    const mediaUrl = formData.get('MediaUrl0');
    const mediaType = formData.get('MediaContentType0');
    const userText = formData.get('Body') || '';
    const userPhone = formData.get('From'); // e.g., 'whatsapp:+1234567890'

    // --- 1. LOAD MEMORY ---
    // We'll use the user's phone number as the key for their conversation
    const historyKey = `chat_${userPhone}`;
    let conversationHistory = await kv.get(historyKey) || [];

    // --- 2. PREPARE AI ---
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // Use gemini-2.5-flash as it's the one that works and is fast
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); 

    // Start a chat session with the full system prompt and past history
    const chat = model.startChat({
      history: conversationHistory,
      systemInstruction: TUTOR_SYSTEM_PROMPT,
    });

    // --- 3. PREPARE USER'S MESSAGE ---
    let userMessage;
    if (mediaUrl) {
      // User sent an image. We'll send the image and any text they sent with it.
      console.log(`Analyzing image from: ${mediaUrl}`);
      const imagePart = await imageToBuffer(mediaUrl, mediaType);
      // Combine text (if any) and the image
      userMessage = [userText, imagePart]; 
    } else {
      // User sent text only
      console.log(`Analyzing text question: ${userText}`);
      userMessage = userText;
    }

    // --- 4. GET AI REPLY ---
    let replyText = "Sorry, I had a little trouble with that. Can you try again?";
    try {
      const result = await chat.sendMessage(userMessage);
      const response = await result.response;
      replyText = response.text();

      // --- 5. SAVE MEMORY ---
      // Update our history with the user's message and the bot's reply
      const userMessageForHistory = { role: "user", parts: [{ text: userText }] };
      // If an image was sent, we'll just note it in the history
      if(mediaUrl) userMessageForHistory.parts.push({ text: "[User sent an image]" });
      
      const botReplyForHistory = { role: "model", parts: [{ text: replyText }] };

      // Add both to our history and save it back to Vercel KV
      const updatedHistory = [
        ...conversationHistory,
        userMessageForHistory,
        botReplyForHistory
      ];
      
      // Save for 1 day (86400 seconds). You can make this longer!
      await kv.set(historyKey, updatedHistory, { ex: 86400 });

    } catch (aiError) {
      console.error("Gemini AI Error:", aiError);
      console.error(aiError); 
      replyText = "Sorry, I had a little trouble analyzing that image. Can you try sending it again?";
    }
    
    // --- 6. SEND REPLY TO USER ---
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