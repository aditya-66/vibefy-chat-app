require('dotenv').config();
const bcrypt = require('bcrypt');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e7 }); 

app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json({limit: '50mb'})); 
app.use(express.urlencoded({limit: '50mb', extended: true}));

// SECURE DATABASE CONNECTION (USING .ENV)
const dbSetup = mysql.createConnection({ 
    host: process.env.DB_HOST, 
    user: process.env.DB_USER, 
    password: process.env.DB_PASSWORD 
});

let db; 
dbSetup.connect(err => {
    if (err) { console.error('MySQL Connection Error:', err.message); return; }
    console.log('Connected to MySQL Server.');

    dbSetup.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`, (err) => {
        db = mysql.createConnection({ 
            host: process.env.DB_HOST, 
            user: process.env.DB_USER, 
            password: process.env.DB_PASSWORD, 
            database: process.env.DB_NAME 
        });

        db.connect(err => {
            if (err) console.error("vibefy_db error:", err);            
            else {
                console.log('Connected to vibefy_db.');
                const createUsersTable = "CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, bio VARCHAR(255) DEFAULT 'Connecting with Vibefy!', dp_path VARCHAR(255) DEFAULT 'default-avatar.png')";
                db.query(createUsersTable, (err) => {});

                const createMsgsTable = "CREATE TABLE IF NOT EXISTS messages (id INT AUTO_INCREMENT PRIMARY KEY, sender VARCHAR(50) NOT NULL, recipient VARCHAR(50) NOT NULL, text TEXT, img LONGTEXT, status VARCHAR(10) DEFAULT 'sent', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)";
                db.query(createMsgsTable, (err) => {
                    db.query("SHOW COLUMNS FROM messages LIKE 'status'", (e, results) => {
                        if (results && results.length === 0) db.query("ALTER TABLE messages ADD COLUMN status VARCHAR(10) DEFAULT 'sent'");
                    });
                    db.query("SHOW COLUMNS FROM messages LIKE 'deleted_for'", (e, results) => {
                        if (results && results.length === 0) db.query("ALTER TABLE messages ADD COLUMN deleted_for VARCHAR(50) DEFAULT NULL");
                    });
                    db.query("SHOW COLUMNS FROM messages LIKE 'deleted_everyone'", (e, results) => {
                        if (results && results.length === 0) db.query("ALTER TABLE messages ADD COLUMN deleted_everyone BOOLEAN DEFAULT FALSE");
                    });
                });
            }
        });
    });
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const folder = file.fieldname === 'dp_image' ? 'uploads/dp' : 'uploads/media';
        cb(null, folder);
    },
    filename: (req, file, cb) => {
        cb(null, req.body.username + '-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

app.get('/api/users', (req, res) => {
    db.query('SELECT username, dp_path FROM users', (err, results) => {
        if (err) res.status(500).json({ error: 'Database error' });
        else res.json(results);
    });
});

app.get('/api/profile/:username', (req, res) => {
    const query = 'SELECT username, bio, dp_path FROM users WHERE username = ?';
    db.query(query, [req.params.username], (err, results) => {
        if (err) res.status(500).json({ error: 'Database error' });
        else if (results.length > 0) res.json(results[0]);
        else res.status(404).json({ error: 'User not found' });
    });
});

app.post('/api/profile/save', upload.single('dp_image'), (req, res) => {
    const { username, bio } = req.body;
    let dpPath = null;
    if (req.file) dpPath = req.file.path.split('\\').join('/');

    let query = 'UPDATE users SET bio = ?';
    let params = [bio];
    if (dpPath) { query += ', dp_path = ?'; params.push(dpPath); }
    query += ' WHERE username = ?';
    params.push(username);

    db.query(query, params, (err, result) => {
        if (err) res.status(500).json({ error: 'Profile save error.' });
        else {
            if(dpPath && userDPs[username]) userDPs[username] = dpPath;
            const onlineList = Object.keys(onlineUsers).map(u => ({ username: u, dp: userDPs[u] }));
            io.emit('user list update', onlineList);
            res.json({ success: 'Profile saved.', dp_path: dpPath });
        }
    });
});

// Recent Chats Fetch Route
app.get('/api/recent-chats/:username', (req, res) => {
    const user = req.params.username;

    // MySQL Query: Ye check karega ki database mein kahan kahan current user shamil hai
    const sqlQuery = `
        SELECT DISTINCT IF(sender = ?, recipient, sender) AS username
        FROM messages 
        WHERE sender = ? OR recipient = ?
    `;

    db.query(sqlQuery, [user, user, user], (err, results) => {
        if (err) {
            console.error("Database query error in recent chats:", err);
            return res.status(500).json([]); // Error aane par khali list bheje
        }
        res.json(results);
    });
});

app.get('/api/messages/:user1/:user2', (req, res) => {
    const { user1, user2 } = req.params;
    
    db.query("UPDATE messages SET status = 'read' WHERE sender = ? AND recipient = ?", [user2, user1], (updateErr) => {
        const query = `
            SELECT * FROM messages 
            WHERE ((sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?))
            AND (deleted_for IS NULL OR deleted_for != ?)
            ORDER BY created_at ASC
        `;
        db.query(query, [user1, user2, user2, user1, user1], (err, results) => {
            if (err) res.status(500).json({ error: 'Database error' });
            else res.json(results);
        });
    });
});

const onlineUsers = {}; 
const userDPs = {}; 
io.on('connection', (socket) => {

// 📞 Fetch Call History Event
    socket.on('get_call_history', () => {
            console.log("➡️ Fetching history from the socket:", socket.id);
            
            const myUsername = Object.keys(onlineUsers).find(key => onlineUsers[key] === socket.id);
            console.log("👤 Username of deleting history:", myUsername);

            if (!myUsername) {
                console.log("❌ ERROR: Server ko user ka naam nahi mila!");
                return;
            }
            if (!db) {
                console.log("❌ ERROR: Database (db) connected nahi hai!");
                return;
            }
            const query = 'SELECT * FROM call_history WHERE caller = ? OR receiver = ? ORDER BY call_time DESC LIMIT 20';
            db.query(query, [myUsername, myUsername], (err, results) => {
                if (err) {
                    console.error("❌ SQL ERROR History fetch karne mein:", err.message);
                    return; 
                }
                
                console.log("✅ History successfully Fetched! Total calls:", results.length);
                socket.emit('call_history_data', { history: results, me: myUsername });
            });
        });

        // Delete Specific Call Record 
        socket.on('delete_call_record', (callId) => {
            console.log("➡️ Server acknowledged the Delete request. Call ID:", callId); // 👈 Backend jasoos
            
            const myUsername = Object.keys(onlineUsers).find(key => onlineUsers[key] === socket.id);
            console.log("👤 Username who Deleted the history:", myUsername);

            if (!myUsername || !db) {
                console.log("❌ ERROR: Username ya Database nahi mila!");
                return;
            }

            const query = 'DELETE FROM call_history WHERE id = ? AND (caller = ? OR receiver = ?)';
            db.query(query, [callId, myUsername, myUsername], (err, result) => {
                if (err) {
                    console.error("❌ SQL ERROR Delete karne mein:", err.message);
                } else {
                    console.log(`✅ SQL Success! No. of records deleted: ${result.affectedRows}`);
                    
                    if (result.affectedRows === 0) {
                        console.log("⚠️ Warning: Database mein is ID ka koi record mila hi nahi, ya user match nahi hua.");
                    }

                    // Delete hone ke baad, bachi hui history wapas bhej do UI refresh karne ke liye
                    const fetchQuery = 'SELECT * FROM call_history WHERE caller = ? OR receiver = ? ORDER BY call_time DESC LIMIT 20';
                    db.query(fetchQuery, [myUsername, myUsername], (fetchErr, results) => {
                        if (!fetchErr) {
                            socket.emit('call_history_data', { history: results, me: myUsername });
                            console.log("🔄 Updated history sent to the UI.");
                        }
                    });
                }
            });
        });
        socket.on('call-user', (data) => {
            const recipientSocketId = onlineUsers[data.to]; 
            const callerUsername = Object.keys(onlineUsers).find(key => onlineUsers[key] === socket.id);

            // DATABASE MEIN CALL HISTORY SAVE KARNE KE LIYE
            if (db && callerUsername) {
                const query = 'INSERT INTO call_history (caller, receiver, call_type) VALUES (?, ?, ?)';
                const typeOfCall = data.callType ? data.callType : 'video';
                db.query(query, [callerUsername, data.to, typeOfCall], (err) => {
                    if(err) console.error("Call history save error:", err.message);
                });
            }

            if (recipientSocketId) {
                io.to(recipientSocketId).emit('call-made', {
                    offer: data.offer,
                    from: callerUsername,
                    callType: data.callType
                });
            }
        });

        // 2. Jab samne wala call uthata hai
        socket.on('make-answer', (data) => {
            const recipientSocketId = onlineUsers[data.to];
            
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('answer-made', {
                    answer: data.answer
                });
            }
        }); 

        // 3. Network details (ICE Candidates) exchange karna
        socket.on('ice-candidate', (data) => {
            const recipientSocketId = onlineUsers[data.to];
            
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('ice-candidate', {
                    candidate: data.candidate
                });
            }
        }); 

        // 4. Jab koi call cut kare
        socket.on('end-call', (data) => {
            console.log("Call ended by: ", data.to);
            const recipientSocketId = onlineUsers[data.to];
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('call-ended');
                console.log("Call Sent!");
            }
        }); 

    socket.on('auto_login', (username) => {
        if (!db) return;
        onlineUsers[username] = socket.id; 
        const query = 'SELECT dp_path FROM users WHERE username = ?';
        db.query(query, [username], (err, results) => {
            if (results && results.length > 0) {
                userDPs[username] = results[0].dp_path;
                const onlineList = Object.keys(onlineUsers).map(u => ({ username: u, dp: userDPs[u] }));
                io.emit('user list update', onlineList);
            }
        });
    });

    // SECURE REGISTRATION 
    socket.on('register', async (data) => {
        if (!db) {
            console.error("❌ ERROR: Database connected nahi hai!");
            return;
        }
        
        try {
            console.log(`➡️ Register request aayi nayi ID ke liye: ${data.username}`);

            // 1. Password ko hash karo (10 rounds of salt)
            const hashedPassword = await bcrypt.hash(data.password, 10);
            
            // 2. Database mein insert
            const query = 'INSERT INTO users (username, password) VALUES (?, ?)';
            db.query(query, [data.username, hashedPassword], (err, result) => {
                if (err) {
                    console.error("❌ SQL ERROR Registration ke time:", err.message); 
                    
                    if (err.code === 'ER_DUP_ENTRY') {
                        // Agar username pehle se kisi ne le liya hai
                        socket.emit('auth error', 'Username already exists.');

                    } else if (err.code === 'ER_DATA_TOO_LONG') {
                        // Agar database ka column chhota pad gaya hash ke liye
                        socket.emit('auth error', 'Database error: Password column ki size badhani padegi.');

                    } else {
                        // Koi aur random error aane par
                        socket.emit('auth error', 'Registration failed. Terminal check karo.');
                    }
                } else {
                    console.log(`✅ SUCCESS: Naya user '${data.username}' register ho gaya!`);
                    socket.emit('register success');
                }
            });
        } catch (error) {
            console.error("❌ Hashing error:", error);
            socket.emit('auth error', 'Server error during registration.');
        }
    });

    // SECURE LOGIN (COMPARING HASH)
    socket.on('login', (data) => {
        if (!db) return;
        
        //Yahan query mein password check NAHI kar rahe, sirf username dhoondh rahe hain
        const query = 'SELECT * FROM users WHERE username = ?';
        db.query(query, [data.username], async (err, results) => {
            if (err) {
                socket.emit('auth error', 'Database error.');
                return;
            }

            if (results && results.length > 0) {
                const dbHashedPassword = results[0].password;
                const isMatch = await bcrypt.compare(data.password, dbHashedPassword);
                
                if (isMatch) {
                    onlineUsers[data.username] = socket.id;
                    userDPs[data.username] = results[0].dp_path; 
                    socket.emit('login success', { username: data.username, dp: results[0].dp_path });
                    
                    const onlineList = Object.keys(onlineUsers).map(u => ({ username: u, dp: userDPs[u] }));
                    io.emit('user list update', onlineList);
                } else {
                    socket.emit('auth error', 'Invalid credentials.'); // Password galat
                }
            } else {
                socket.emit('auth error', 'Invalid credentials.'); // Username nahi mila
            }
        });
    });

    socket.on('private message', (data) => {
        const query = 'INSERT INTO messages (sender, recipient, text, img, status) VALUES (?, ?, ?, ?, ?)';
        db.query(query, [data.sender, data.recipient, data.text, data.img, 'sent'], (err, result) => {
            if(err) return console.error("Error saving message:", err.message);
            
            data.id = result.insertId; 
            data.deleted_everyone = 0;
            
            const recipientSocketId = onlineUsers[data.recipient];
            if (recipientSocketId) {
                io.to(recipientSocketId).emit('private message', data);
            }
            socket.emit('message_sent_success', data);
        });
    });

    socket.on('delete_message', (data) => {
        if (data.type === 'everyone') {
            db.query("UPDATE messages SET deleted_everyone = TRUE WHERE id = ?", [data.id], () => {
                io.emit('message_deleted_everyone', { id: data.id });
            });
        } else if (data.type === 'me') {
            db.query("UPDATE messages SET deleted_for = ? WHERE id = ?", [data.user, data.id]);
        }
    });

    socket.on('delete_conversation', (data) => {
        const { user, partner } = data;
        // Step 1: Agar partner ne pehle hi delete kar diya hai, toh Database se permanently uda do
        db.query("DELETE FROM messages WHERE ((sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)) AND deleted_for = ?", [user, partner, partner, user, partner], (err) => {
            // Step 2: Baki messages ko current user ke liye hide kar do
            db.query("UPDATE messages SET deleted_for = ? WHERE ((sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)) AND deleted_for IS NULL", [user, user, partner, partner, user], () => {
                socket.emit('conversation_deleted_success', partner);
            });
        });
    });

    socket.on('delete_account', (username) => {
        db.query("DELETE FROM users WHERE username = ?", [username], () => {
            db.query("DELETE FROM messages WHERE sender = ? OR recipient = ?", [username, username], () => {
                delete onlineUsers[username];
                delete userDPs[username];
                io.emit('user list update', Object.keys(onlineUsers).map(u => ({ username: u, dp: userDPs[u] })));
                socket.emit('account_deleted_success');
            });
        });
    });

    socket.on('mark_read', (data) => {
        db.query("UPDATE messages SET status = 'read' WHERE sender = ? AND recipient = ?", [data.sender, data.recipient], (err) => {
            if (!err) {
                const senderSocketId = onlineUsers[data.sender];
                if (senderSocketId) {
                    io.to(senderSocketId).emit('messages_read_by_recipient', { reader: data.recipient });
                }
            }
        });
    });

    socket.on('typing', (data) => {
        const recipientSocketId = onlineUsers[data.recipient];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('typing', { sender: data.sender, isTyping: data.isTyping });
        }
    });

    socket.on('disconnect', () => {
        let disconnectedUser = null;
        for (const [username, id] of Object.entries(onlineUsers)) {
            if (id === socket.id) {
                disconnectedUser = username;
                delete onlineUsers[username];
                delete userDPs[username];
                break;
            }
        }
        if (disconnectedUser) {
            const onlineList = Object.keys(onlineUsers).map(u => ({ username: u, dp: userDPs[u] }));
            io.emit('user list update', onlineList);
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log('Vibefy server running on http://localhost:' + PORT);
});