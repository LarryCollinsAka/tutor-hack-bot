import { NextResponse } from 'next/server';
import { twiml } from 'twilio';
import { GoogleGenerativeAI } from '@google/generative-ai';

import { IMAGE_TUTOR_PROMPT, TEXT_TUTOR_PROMPT } from '@/app/lib/prompt';

// --- A "health check" for us to test in the browser ---
export async function GET(request) {
  return NextResponse.json({ message: 'The tutor bot is ALIVE and ready for AI!' });
}

// --- Our authenticated fetch function (no changes) ---
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

// --- Our main function that handles incoming messages ---
export async function POST(request) {
  try {
    const formData = await request.formData();
    const mediaUrl = formData.get('MediaUrl0');
    const mediaType = formData.get('MediaContentType0');
    const userText = formData.get('Body') || ''; // The user's text message
    
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    let replyText = "I'm not sure how to help with that. Please send a photo of a math problem or ask me a math/science question.";
    let generationRequest;

    // --- THIS IS THE NEW LOGIC ---
    if (mediaUrl) {
      // --- 1. HANDLE IMAGE REQUEST ---
      console.log(`Analyzing image from: ${mediaUrl} (Type: ${mediaType})`);
      const imagePart = await imageToBuffer(mediaUrl, mediaType);
      generationRequest = model.generateContent([IMAGE_TUTOR_PROMPT, imagePart]);

    } else if (userText.trim().length > 0) {
      // --- 2. HANDLE TEXT REQUEST ---
      console.log(`Analyzing text question: ${userText}`);
      // We combine the system prompt with the user's question
      generationRequest = model.generateContent([TEXT_TUTOR_PROMPT, userText]);
      
    } else {
      // --- 3. HANDLE EMPTY MESSAGE ---
      replyText = "Please send me a photo of your homework or a math/science question!";
    }
    
    // --- Run the selected AI request ---
    if (generationRequest) {
      try {
        const result = await generationRequest;
        const response = await result.response;
        replyText = response.text();
      } catch (aiError) {
        console.error("Gemini AI Error:", aiError);
        console.error(aiError); 
        replyText = "Sorry, I had a little trouble with that request. Can you try sending it again?";
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