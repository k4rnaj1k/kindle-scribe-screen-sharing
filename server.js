const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
    const server = createServer(async (req, res) => {
        try {
            const parsedUrl = parse(req.url, true);
            await handle(req, res, parsedUrl);
        } catch (err) {
            console.error('Error occurred handling', req.url, err);
            res.statusCode = 500;
            res.end('internal server error');
        }
    });

    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
        const parsedUrl = parse(request.url, true);
        if (parsedUrl.pathname === '/api/screen') {
            wss.handleUpgrade(request, socket, head, (ws) => {
                ws.kindleIp = parsedUrl.query.ip || '192.168.50.73';
                ws.kindlePort = parsedUrl.query.port || '2222';
                wss.emit('connection', ws, request);
            });
        }
    });

    // SSH and FFmpeg setup

    let ffmpegProcess = null;

    const startStream = (ip, port) => {
        if (ffmpegProcess) return;

        console.log(`Starting screen capture stream from ${ip}:${port}...`);

        // Run ssh and pipe to ffmpeg via shell or we can do it with spawn

        const command = `ssh root@${ip} -p ${port} -o StrictHostKeyChecking=no -o BatchMode=yes "while true; do dd if=/dev/fb0 bs=1872 count=2480 2>/dev/null; sleep 1; done" | ffmpeg -loglevel warning -f rawvideo -pixel_format gray -video_size 1872x2480 -framerate 1 -i - -vf "crop=1860:2480:0:0" -r 1 -f image2pipe -vcodec mjpeg pipe:1`;

        ffmpegProcess = spawn(command, { shell: true });

        ffmpegProcess.stdout.on('data', () => {
            // data chunk might not be a full JPEG if chunks are small...
        });

        ffmpegProcess.stderr.on('data', (data) => {
            console.error(`ffmpeg stderr: ${data}`);
        });

        ffmpegProcess.on('close', (code) => {
            console.log(`Child process exited with code ${code}`);
            ffmpegProcess = null;
        });
    };

    let buffer = Buffer.alloc(0);

    const processData = (data) => {
        buffer = Buffer.concat([buffer, data]);

        while (true) {
            const startIndex = buffer.indexOf(Buffer.from([0xff, 0xd8]));
            if (startIndex === -1) break;

            const endIndex = buffer.indexOf(Buffer.from([0xff, 0xd9]), startIndex);
            if (endIndex === -1) break;

            const frameIndex = endIndex + 2;
            const frameBuffer = buffer.slice(startIndex, frameIndex);

            wss.clients.forEach((client) => {
                if (client.readyState === 1 /* WebSocket.OPEN */) {
                    client.send(frameBuffer);
                }
            });

            buffer = buffer.slice(frameIndex);
        }
    };

    wss.on('connection', (ws) => {
        console.log(`Client connected (IP: ${ws.kindleIp}, Port: ${ws.kindlePort})`);

        if (wss.clients.size === 1) {
            // Start streaming when the first client connects
            startStream(ws.kindleIp, ws.kindlePort);
            if (ffmpegProcess) {
                ffmpegProcess.stdout.on('data', processData);
            }
        }

        ws.on('close', () => {
            console.log('Client disconnected');
            if (wss.clients.size === 0 && ffmpegProcess) {
                // Stop streaming if no clients are connected to save resources
                console.log("Stopping stream (no clients)...");
                ffmpegProcess.kill();
                ffmpegProcess = null;
                buffer = Buffer.alloc(0);
            }
        });
    });

    server.once('error', (err) => {
        console.error(err);
        process.exit(1);
    });

    server.listen(port, () => {
        console.log(`> Ready on http://${hostname}:${port}`);
    });
});
