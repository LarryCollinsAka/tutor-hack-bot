import { NextResponse } from 'next/server';
import { twiml } from 'twilio';

// handles incoming messages
export async function POST(request) {
  // Get the data from Twilio's request
  const formData = await request.formData();
  const body = formData.get('Body') || 'No text'; // The text the user sent
  const mediaUrl = formData.get('MediaUrl0'); // The URL of the image, if any
  const from = formData.get('From'); // The user's WhatsApp number

  // Log what we received so we can see it in the Vercel logs
  console.log(`Received message from ${from}:`);
  console.log(`Text Body: ${body}`);
  console.log(`Media URL: ${mediaUrl}`);

  // --- This is where our AI logic will go soon ---
  // For now, just send a simple test reply
  
  let replyText = "Hello! I received your message. I am not smart yet.";
  
  if (mediaUrl) {
    replyText = "Great! I received your image. I will analyze it soon.";
  } else {
    replyText = "Please send me an image of your math homework.";
  }
  
  // --- Create the Twilio TwiML response ---
  const messagingResponse = new twiml.MessagingResponse();
  messagingResponse.message(replyText);
  
  // Convert the TwiML to an XML string
  const twimlResponse = messagingResponse.toString();

  // Send the TwiML response back to Twilio
  return new NextResponse(twimlResponse, {
    headers: {
      'Content-Type': 'text/xml',
    },
  });
}