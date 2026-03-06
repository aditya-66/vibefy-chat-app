# 📱 Vibefy Chat App 

***Vibefy is a real-time, full-stack chat application with integrated calling features. Built for seamless communication, it uses a modern tech stack to ensure speed, security, and reliability.***

## ✨ Features

- Real-time Messaging: Instant chat using WebSockets (Socket.io) for a lag-free experience.
- User Authentication: Secure Registration and Login system.
- Voice/Video Calling: Integrated calling feature for enhanced communication.
- Cloud Database: Powered by Aiven MySQL for 24/7 data availability.
- Responsive UI: Dark-themed, modern interface optimized for all devices.

## 🛠️ Tech Stack

- Frontend: HTML5, CSS3 (Modern UI), JavaScript (Client-side).
- Backend: Node.js, Express.js.
- Database: MySQL (Hosted on Aiven Cloud).
- Deployment: Render (Web Service).

## 📂 Database Schema
*The app uses the following core tables in MySQL:*

- users: Stores user credentials and registration info.
- messages: Stores chat history between users.
- call_history: Logs call details (caller, receiver, type, and time).

## 🛡️ Security

- SSL Connection: Database connections are secured via SSL for cloud deployment.
- IP Whitelisting: Restricted access via Aiven Firewall.
