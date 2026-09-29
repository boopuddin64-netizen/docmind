import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log("Add these to your environment (Vercel → Project → Settings → Environment Variables, or .env locally):\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:you@example.com   # or your https:// site URL`);
console.log("\nKeep VAPID_PRIVATE_KEY secret. Changing the keys later invalidates every existing push subscription.");
