"use client";

import { useEffect, useState, useRef } from "react";
import { RotateCcw, RotateCw, Maximize, Play, Square } from "lucide-react";

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [rotation, setRotation] = useState<number>(0);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isError, setIsError] = useState<boolean>(false);
  const [hasFrame, setHasFrame] = useState<boolean>(false);
  const [ip, setIp] = useState<string>("192.168.50.73");
  const [port, setPort] = useState<string>("2222");
  const [shouldConnect, setShouldConnect] = useState<boolean>(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let unlisten: (() => void) | null = null;

    const setupConnection = async () => {
      if (!shouldConnect) {
        setIsConnected(false);
        setHasFrame(false);

        const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
        if (isTauri) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('stop_stream');
          } catch (e) {
            console.error("Failed to stop Tauri stream", e);
          }
        }
        return;
      }

      const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

      const renderFrame = async (blob: Blob) => {
        try {
          const bitmap = await window.createImageBitmap(blob);
          const canvas = canvasRef.current;
          if (canvas) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.filter = 'contrast(1.1) brightness(0.98) grayscale(1)';
              ctx.drawImage(bitmap, 0, 0);
              setHasFrame(true);
            }
          }
        } catch (e) {
          console.error("Failed to render frame to canvas", e);
        }
      };

      if (isTauri) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const { listen } = await import('@tauri-apps/api/event');

          unlisten = await listen<number[]>('frame', async (event) => {
            const u8 = new Uint8Array(event.payload);
            const blob = new Blob([u8], { type: 'image/jpeg' });
            await renderFrame(blob);
          });

          await invoke('start_stream', { ip, port });
          console.log("Connected to screen stream (Tauri)");
          setIsConnected(true);
          setIsError(false);

        } catch (error) {
          console.error("Tauri connection error:", error);
          setIsError(true);
          setIsConnected(false);
        }
      } else {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/api/screen?ip=${encodeURIComponent(ip)}&port=${encodeURIComponent(port)}`;

        ws = new WebSocket(wsUrl);
        ws.binaryType = "blob";

        ws.onopen = () => {
          console.log("Connected to screen stream (WebSocket)");
          setIsConnected(true);
          setIsError(false);
        };

        ws.onmessage = async (event) => {
          if (event.data instanceof Blob) {
            await renderFrame(event.data);
          }
        };

        ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          setIsError(true);
          setIsConnected(false);
        };

        ws.onclose = () => {
          console.log("Disconnected from screen stream");
          setIsConnected(false);
          setShouldConnect(false);
        };
      }
    };

    setupConnection();

    return () => {
      if (ws) ws.close();
      if (unlisten) unlisten();
    };
  }, [shouldConnect, ip, port]);

  const handleRotateLeft = () => setRotation((r) => (r - 90 + 360) % 360);
  const handleRotateRight = () => setRotation((r) => (r + 90) % 360);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  return (
    <div className="min-h-screen bg-neutral-900 flex flex-col items-center justify-center p-2 sm:p-4 text-white font-sans">
      <div className="mb-4 flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4 items-center">
        <h1 className="text-lg sm:text-xl font-medium sm:mr-2 text-neutral-300 tracking-tight">Kindle Scribe Screenshare</h1>

        <div className="flex bg-neutral-800 rounded-lg p-1 border border-neutral-700 shadow-sm items-center">
          <input
            type="text"
            value={ip}
            onChange={e => setIp(e.target.value)}
            placeholder="IP Address"
            className="bg-transparent text-neutral-300 px-2 w-32 outline-none text-sm font-mono"
            disabled={shouldConnect}
          />
          <div className="w-px bg-neutral-700 mx-1 h-5"></div>
          <input
            type="text"
            value={port}
            onChange={e => setPort(e.target.value)}
            placeholder="Port"
            className="bg-transparent text-neutral-300 px-2 w-16 outline-none text-sm font-mono"
            disabled={shouldConnect}
          />
          <div className="w-px bg-neutral-700 mx-1 h-5"></div>
          <button
            onClick={() => setShouldConnect(!shouldConnect)}
            className={`p-1.5 sm:p-2 rounded-md transition-colors ${shouldConnect ? 'hover:bg-red-900/50 text-red-400' : 'hover:bg-green-900/50 text-green-400'}`}
            title={shouldConnect ? "Disconnect" : "Connect"}
          >
            {shouldConnect ? <Square className="w-4 h-4 sm:w-5 sm:h-5" /> : <Play className="w-4 h-4 sm:w-5 sm:h-5" />}
          </button>
        </div>

        <div className="flex bg-neutral-800 rounded-lg p-1 border border-neutral-700 shadow-sm">
          <button
            onClick={handleRotateLeft}
            className="p-1.5 sm:p-2 hover:bg-neutral-700 rounded-md transition-colors"
            title="Rotate Left"
          >
            <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5 text-neutral-300" />
          </button>
          <button
            onClick={handleRotateRight}
            className="p-1.5 sm:p-2 hover:bg-neutral-700 rounded-md transition-colors"
            title="Rotate Right"
          >
            <RotateCw className="w-4 h-4 sm:w-5 sm:h-5 text-neutral-300" />
          </button>
          <div className="w-px bg-neutral-700 mx-1 my-1"></div>
          <button
            onClick={toggleFullscreen}
            className="p-1.5 sm:p-2 hover:bg-neutral-700 rounded-md transition-colors"
            title="Fullscreen"
          >
            <Maximize className="w-4 h-4 sm:w-5 sm:h-5 text-neutral-300" />
          </button>
        </div>
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : isError ? 'bg-red-500' : shouldConnect ? 'bg-yellow-500 animate-pulse' : 'bg-neutral-600'}`}></div>
          <span className="text-sm text-neutral-400">
            {isConnected ? 'Connected' : isError ? 'Error/Disconnected' : shouldConnect ? 'Connecting...' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Kindle Scribe Device Mockup */}
      <div
        ref={containerRef}
        className="bg-[#E5E7EB] rounded-[24px] sm:rounded-[40px] shadow-2xl overflow-hidden border-[#D1D5DB] border-[2px] flex flex-row"
        style={{
          width: 'min(98vw, 85vh, 1200px)',
        }}
      >
        {/* The asymmetrical bezel: Scribe has a wider bezel on one side. */}
        <div className="w-12 sm:w-20 border-r border-black/5 flex-shrink-0 flex flex-col items-center justify-center">
          {/* Optional details for the spine/bezel */}
        </div>
        <div className="flex-1 p-3 sm:p-5 pl-0">
          {/* Inner screen bezel */}
          <div
            className="w-full bg-[#e0e0e0] border-4 sm:border-8 border-black/80 rounded-lg overflow-hidden relative flex items-center justify-center shadow-inner"
            style={{ aspectRatio: '1860 / 2480' }}
          >
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-white">
              <canvas
                ref={canvasRef}
                className={`object-contain transition-transform duration-300 ease-in-out max-w-none origin-center ${hasFrame ? 'opacity-100' : 'opacity-0'}`}
                style={{
                  transform: `rotate(${rotation}deg) ${rotation % 180 !== 0 ? 'scale(1.333)' : 'scale(1)'}`, // 4/3 ratio offset
                  width: '100%',
                  height: '100%',
                }}
              />
            </div>

            {!hasFrame && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-500 z-10 bg-white">
                <p className="mb-2 font-medium">
                  {!shouldConnect ? "Click Connect to start stream" : "Awaiting screen stream..."}
                </p>
                {shouldConnect && <div className="w-8 h-8 border-4 border-neutral-400 border-t-neutral-600 rounded-full animate-spin"></div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
