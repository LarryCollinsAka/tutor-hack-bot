import { NextResponse } from 'next/server';
import { twiml } from 'twilio';
import { kv } from '@vercel/kv'; // We'll use KV for the queue

export async function POST(request) {
  try {
    const formData = await request.formData();
    
    // Get all the data from the user's message
    const messagePayload = {
      from: formData.get('From'),
      body: formData.get('Body') || '',
      mediaUrl: formData.get('MediaUrl0'),
      mediaType: formData.get('MediaContentType0'),
    };

    // --- 1. PUSH TO QUEUE ---
    await kv.lpush('tutor_queue', JSON.stringify(messagePayload));

    // --- 2. INSTANT REPLY ---
    const messagingResponse = new twiml.MessagingResponse();
    messagingResponse.message("Got it! Your tutor is thinking... 🧠");
    
    const twimlResponse = messagingResponse.toString();

    // Send the TwiML response back to Twilio
    return new NextResponse(twimlResponse, {
      headers: { 'Content-Type': 'text/xml' },
    });

  } catch (error) {
    console.error("Webhook POST Error:", error);
    // Send a generic error if the webhook itself fails
    const messagingResponse = new twiml.MessagingResponse();
    messagingResponse.message("Sorry, I had trouble receiving your message. Please try again.");
    return new NextResponse(messagingResponse.toString(), {
      headers: { 'Content-Type': 'text/xml' },
      status: 500,
    });
  }
}