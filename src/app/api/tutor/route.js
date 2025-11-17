import { NextResponse } from 'next/server';
import { twiml } from 'twilio';
import { GoogleGenerativeAI } from '@google/generative-ai';

import { TUTOR_PROMPT } from '@/app/lib/prompt';

// --- A "health check" for us to test in the browser ---
export async function GET(request) {
  return NextResponse.json({ message: 'The tutor bot is ALIVE and ready for AI!' });
}

// --- Our authenticated fetch function ---
async function imageToBuffer(url, mimeType) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  // Make an AUTHENTICATED request to the Twilio API
  const response = await fetch(url, {
    headers: { 'Authorization': authHeader }
  });

  
  if (!response.ok) {
    const errorBody = await response.text(); // Get the error message from Twilio
    console.error(`Twilio fetch failed: ${response.status} ${response.statusText}`, errorBody);
    throw new Error(`Failed to fetch image from Twilio: ${response.status}`);
  }

  // Now we'll get the real image
  const arrayBuffer = await response.arrayBuffer();
  
  return {
    inlineData: {
      data: Buffer.from(arrayBuffer).toString('base64'),
      mimeType: mimeType || 'image/jpeg', 
    },
  };
}

// --- Our main function that handles incoming messages ---
export async function POST(request) {
  try {
    const formData = await request.formData();
    const mediaUrl = formData.get('MediaUrl0'); // The URL of the image
    const mediaType = formData.get('MediaContentType0'); // The real MIME type
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); 

    let replyText = "Please send me a photo of your math homework so I can help!";

    if (mediaUrl) {
      console.log(`Analyzing image from: ${mediaUrl} (Type: ${mediaType})`);
      try {
        const imagePart = await imageToBuffer(mediaUrl, mediaType); 
        
        const result = await model.generateContent([TUTOR_PROMPT, imagePart]);
        const response = await result.response;
        replyText = response.text();

      } catch (aiError) {
        console.error("Gemini AI Error:", aiError);
        console.error(aiError); // Log the full error
        replyText = "Sorry, I had a little trouble analyzing that image. Can you try sending it again?";
      }
    }
    
    // --- Create and send the TwiML response ---
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