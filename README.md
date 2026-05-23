# 🟣 PulseStream — Live Streaming Platform

A real, production-ready live streaming platform with WebRTC, screen sharing, live chat, polls, and emoji reactions.

---

## ✅ Features

- **Real live streaming** via WebRTC (peer-to-peer, no 3rd party needed)
- **Screen sharing** with your camera as picture-in-picture
- **Live chat** — all viewers chat in real-time
- **Live polls** — host creates polls, viewers vote live
- **Emoji reactions** — float up on screen for everyone
- **Viewer count** — live count of people watching
- **Stream uptime timer**
- **Roles**: First person to open = Host, everyone else = Viewer

---

## 🚀 Setup (5 minutes)

### Requirements
- **Node.js v16+** → Download from https://nodejs.org
- A computer (Windows, Mac, or Linux)

### Step 1: Install
```bash
cd pulsestream
npm install
```

### Step 2: Start the server
```bash
npm start
```

You'll see:
```
🟣 PulseStream running at http://localhost:3000
```

### Step 3: Open the app
- Open your browser and go to: **http://localhost:3000**
- You are now the **HOST** (first to connect)
- Share the link with friends — they join as **viewers**

---

## 🌐 Going Live on the Internet (Free Options)

### Option A: ngrok (easiest, for testing)
1. Download ngrok: https://ngrok.com/download
2. Run: `ngrok http 3000`
3. Copy the `https://xxxx.ngrok.io` URL and share it

### Option B: Railway (permanent, free tier)
1. Create account at https://railway.app
2. Upload this folder
3. Set start command: `npm start`
4. Get a permanent URL like `pulsestream.up.railway.app`

### Option C: Render (free hosting)
1. Push to GitHub
2. Create account at https://render.com
3. New Web Service → connect your repo
4. Set: Build Command = `npm install`, Start Command = `npm start`

### Option D: Your own VPS (DigitalOcean, AWS, etc.)
1. Upload files to server
2. Run `npm install && npm start`
3. Open port 3000 (or use nginx to proxy port 80)
4. Use your server's IP or domain

---

## 📁 File Structure

```
pulsestream/
├── server/
│   └── index.js          ← Node.js server + Socket.io signaling
├── public/
│   ├── index.html         ← Main page (host + viewer)
│   ├── css/
│   │   └── style.css      ← All styles
│   └── js/
│       ├── webrtc.js      ← WebRTC peer connection manager
│       └── app.js         ← UI logic, socket events, polls, chat
├── package.json
└── README.md
```

---

## 🔧 How It Works

1. **First person** to open the page becomes the **Host**
2. Host clicks ⚡ Go Live → sets title & category → stream starts
3. Host turns on 🖥 Screen Share and/or 📷 Camera
4. **Viewers** who open the link receive the stream via WebRTC (direct browser-to-browser)
5. Everyone can chat, react, and vote on polls in real-time
6. When host ends stream, all viewers are notified

---

## 🔮 Coming Next (Subscription System)

When you're ready to add subscriptions:
- Add **user accounts** (passport.js + MongoDB)
- Add **Stripe payments** for monthly/daily subscriptions
- Gate the viewer page behind a subscription check
- Add a **dashboard** for the host to manage subscribers

---

## 💡 Tips

- Use **Chrome or Edge** for best WebRTC support
- For screen sharing, Chrome will show a screen-picker dialog — select what you want to share
- The camera shows as a small picture-in-picture when screen sharing is active
- **HTTPS is required** for screen share + camera on production deployments (all the hosting options above provide this automatically)

---

Built with ❤️ using Node.js, Socket.io, and WebRTC
