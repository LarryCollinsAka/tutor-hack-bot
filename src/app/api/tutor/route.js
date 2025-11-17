import { NextResponse } from 'next/server';
import { twiml } from 'twilio';
import { GoogleGenerativeAI } from '@google/generative-ai';

import { TUTOR_PROMPT } from '@/app/lib/prompt';

// --- A "health check" for us to test in the browser ---
export async function GET(request) {
  return NextResponse.json({ message: 'The tutor bot is ALIVE and ready for AI!' });
}

// --- Helper function to fetch the image from Twilio's URL and turn it into a buffer ---
async function imageToBuffer(url) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return {
    inlineData: {
      data: Buffer.from(arrayBuffer).toString('base64'),
      mimeType: response.headers.get('content-type') || 'image/jpeg',
    },
  };
}

// --- Our main function that handles incoming messages ---
export async function POST(request) {
  try {
    const formData = await request.formData();
    const mediaUrl = formData.get('MediaUrl0'); // The URL of the image
    const from = formData.get('From'); // The user's WhatsApp number

    // --- Create the AI client ---
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // --- Use the new, faster model from your suggestion ---
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }); 

    let replyText = "Please send me a photo of your math homework so I can help!";

    // --- If there is an image, run the AI ---
    if (mediaUrl) {
      console.log(`Analyzing image from: ${mediaUrl}`);
      try {
        const imagePart = await imageToBuffer(mediaUrl);
        
        // --- Use your new, much better prompt! ---
        const result = await model.generateContent([TUTOR_PROMPT, imagePart]);
        const response = await result.response;
        replyText = response.text();

      } catch (aiError) {
        console.error("Gemini AI Error:", aiError);
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