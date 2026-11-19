import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Upload,
  X,
  Loader2,
  PenLine,
  AlertCircle,
  WifiOff,
  FileImage,
  CheckCircle2,
  Crop,
  Info,
  Sun,
  Maximize2,
  Layers,
} from 'lucide-react';
import {
  compressReceiptFile,
  encodeCanvasWithinBudget,
  MAX_RECEIPT_DATA_URL_LENGTH,
} from '../utils/storage';
import {
  AlignmentHint,
  computeQuadCropRect,
  detectReceiptFromVideo,
  ReceiptQuad,
  smoothReceiptQuad,
  SourceCropRect,
} from '../utils/receiptEdgeDetector';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface CaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImageReadyForScan: (dataUrl: string, mimeType: string) => Promise<void>;
  onQueueOfflineScan: (dataUrl: string, mimeType: string) => void;
  onManualEntry: () => void;
  isScanning: boolean;
  scanStatus: string | null;
  scanError: string | null;
}

const SAMPLE_RECEIPTS = [
  {
    id: 'cafe',
    title: 'Roastery & Co.',
    subtitle: 'Coffee & Bakery · $17.90',
    imagePath: '/src/assets/images/sample_cafe_receipt_1794888962062.jpg',
  },
  {
    id: 'grocery',
    title: 'Greenleaf Market',
    subtitle: 'Groceries · $38.36',
    imagePath: '/src/assets/images/sample_grocery_receipt_1794888962287.jpg',
  },
];

export const CaptureModal: React.FC<CaptureModalProps> = ({
  isOpen,
  onClose,
  onImageReadyForScan,
  onQueueOfflineScan,
  onManualEntry,
  isScanning,
  scanStatus,
  scanError,
}) => {
  const isOnline = useOnlineStatus();
  const [mode, setMode] = useState<'upload' | 'camera'>('upload');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [queuedNotice, setQueuedNotice] = useState(false);
  const [loadingSampleId, setLoadingSampleId] = useState<string | null>(null);
  const [lastImage, setLastImage] = useState<{ dataUrl: string; mimeType: string } | null>(null);
  const [autoCropEnabled, setAutoCropEnabled] = useState(true);
  const [showScanTips, setShowScanTips] = useState(false);
  const [edgeOverlay, setEdgeOverlay] = useState<{
    quad: ReceiptQuad;
    isAligned: boolean;
    alignmentHint: AlignmentHint;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewfinderRef = useRef<HTMLDivElement | null>(null);
  const cvCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const smoothedQuadRef = useRef<ReceiptQuad | null>(null);
  const missedFramesRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraFileInputRef = useRef<HTMLInputElement | null>(null);

  const isBusy = isPreparing || isScanning;

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setMode('upload');
      setCameraError(null);
      setIsCameraReady(false);
      setIsPreparing(false);
      setLocalError(null);
      setQueuedNotice(false);
      setShowScanTips(false);
      return;
    }
    return () => stopCamera();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || mode !== 'camera' || isBusy) {
      stopCamera();
      setIsCameraReady(false);
      return;
    }

    let cancelled = false;
    setCameraError(null);
    setIsCameraReady(false);

    const startCamera = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('Live camera streaming is not supported in this browser. Use "Take Photo" or upload a file instead.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1920 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch {
        if (!cancelled) {
          setCameraError('Camera access was blocked or unavailable. You can still use "Take Photo" on mobile or upload an image.');
        }
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [isOpen, mode, isBusy]);

  useEffect(() => {
    const active = isOpen && mode === 'camera' && !cameraError && !isBusy && isCameraReady;
    if (!active) {
      smoothedQuadRef.current = null;
      missedFramesRef.current = 0;
      setEdgeOverlay(null);
      return;
    }

    if (!cvCanvasRef.current && typeof document !== 'undefined') {
      cvCanvasRef.current = document.createElement('canvas');
    }

    let rafId = 0;
    let lastScanAt = 0;
    const SCAN_INTERVAL_MS = 120;

    const tick = (now: number) => {
      if (now - lastScanAt >= SCAN_INTERVAL_MS && !document.hidden) {
        lastScanAt = now;
        const video = videoRef.current;
        const container = viewfinderRef.current;
        if (video && container && cvCanvasRef.current) {
          const result = detectReceiptFromVideo(
            video,
            container.clientWidth,
            container.clientHeight,
            cvCanvasRef.current
          );

          if (result.detected && result.quad) {
            missedFramesRef.current = 0;
            const smoothed = smoothReceiptQuad(smoothedQuadRef.current, result.quad);
            smoothedQuadRef.current = smoothed;
            setEdgeOverlay({
              quad: smoothed,
              isAligned: result.isAligned,
              alignmentHint: result.alignmentHint,
            });
          } else {
            missedFramesRef.current += 1;
            if (missedFramesRef.current >= 3) {
              smoothedQuadRef.current = null;
              setEdgeOverlay(null);
            }
          }
        }
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [isOpen, mode, cameraError, isBusy, isCameraReady]);

  if (!isOpen) return null;

  const processCompressed = async (compressed: { dataUrl: string; mimeType: string }) => {
    setLastImage(compressed);
    setLocalError(null);
    setQueuedNotice(false);

    const currentlyOnline = typeof navigator !== 'undefined' ? navigator.onLine : isOnline;
    if (!currentlyOnline) {
      onQueueOfflineScan(compressed.dataUrl, compressed.mimeType);
      setQueuedNotice(true);
      return;
    }
    await onImageReadyForScan(compressed.dataUrl, compressed.mimeType);
  };

  const handleFileChange = async (file: File | undefined, inputEl?: HTMLInputElement | null) => {
    if (!file) return;
    setLocalError(null);
    setQueuedNotice(false);

    if (file.type && !file.type.startsWith('image/')) {
      if (inputEl) inputEl.value = '';
      await onImageReadyForScan('', file.type);
      return;
    }

    setIsPreparing(true);
    try {
      const compressed = await compressReceiptFile(
        file,
        1200,
        0.8,
        MAX_RECEIPT_DATA_URL_LENGTH,
        autoCropEnabled
      );
      if (inputEl) inputEl.value = '';
      setIsPreparing(false);
      await processCompressed(compressed);
    } catch (err) {
      setIsPreparing(false);
      if (inputEl) inputEl.value = '';
      setLocalError(
        err instanceof Error
          ? err.message
          : 'Could not prepare this photo for scanning. Please try another image.'
      );
    }
  };

  const handleCaptureFrame = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError('Camera stream is not ready yet. Please wait a moment and try again.');
      return;
    }

    setLocalError(null);
    setQueuedNotice(false);
    setIsPreparing(true);

    try {
      let cropRect: SourceCropRect | undefined;
      if (autoCropEnabled) {
        const container = viewfinderRef.current;
        const vpW = container?.clientWidth || video.clientWidth || video.videoWidth;
        const vpH = container?.clientHeight || video.clientHeight || video.videoHeight;
        let activeQuad = smoothedQuadRef.current;
        if (!activeQuad) {
          const liveDetection = detectReceiptFromVideo(
            video,
            vpW,
            vpH,
            cvCanvasRef.current ?? undefined
          );
          if (liveDetection.detected && liveDetection.quad) {
            activeQuad = liveDetection.quad;
          }
        }
        if (activeQuad) {
          cropRect = computeQuadCropRect(
            video.videoWidth,
            video.videoHeight,
            vpW,
            vpH,
            activeQuad
          );
        }
      }

      const dataUrl = encodeCanvasWithinBudget(
        video,
        video.videoWidth,
        video.videoHeight,
        1200,
        0.8,
        MAX_RECEIPT_DATA_URL_LENGTH,
        cropRect
      );
      if (!dataUrl) {
        throw new Error('Could not capture frame from camera.');
      }
      setIsPreparing(false);
      await processCompressed({ dataUrl, mimeType: 'image/jpeg' });
    } catch (err) {
      setIsPreparing(false);
      setLocalError(
        err instanceof Error ? err.message : 'Unable to capture photo from camera.'
      );
    }
  };

  const handleSampleReceipt = async (sample: (typeof SAMPLE_RECEIPTS)[number]) => {
    setLocalError(null);
    setQueuedNotice(false);
    setLoadingSampleId(sample.id);
    setIsPreparing(true);
    try {
      const res = await fetch(sample.imagePath);
      if (!res.ok) throw new Error('Could not load sample receipt.');
      const blob = await res.blob();
      const compressed = await compressReceiptFile(blob);
      setIsPreparing(false);
      await processCompressed(compressed);
    } catch (err) {
      setIsPreparing(false);
      setLocalError(
        err instanceof Error ? err.message : 'Could not load sample receipt.'
      );
    } finally {
      setLoadingSampleId(null);
    }
  };

  const activeError = localError || scanError;
  const isFullScreenCamera = mode === 'camera' && !cameraError && !isBusy;

  const scanTipsModal = showScanTips ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="how-to-scan-title"
      onClick={() => setShowScanTips(false)}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-xs sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white text-slate-900 shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-400">
              <Info className="h-4 w-4" />
            </div>
            <div>
              <h3 id="how-to-scan-title" className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                How to Scan a Receipt
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Quick tips for accurate OCR extraction
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowScanTips(false)}
            aria-label="Close scan tips"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          {/* Simple Visual Framing Illustration */}
          <div className="rounded-2xl border border-slate-200 bg-slate-900 p-4 text-white dark:border-slate-800 dark:bg-slate-950">
            <div className="mx-auto flex max-w-[240px] items-center justify-center gap-4">
              <svg
                viewBox="0 0 180 120"
                className="h-28 w-full"
                role="img"
                aria-label="Illustration showing a flat well-lit receipt centered inside green alignment brackets"
              >
                {/* Dark tabletop contrast surface */}
                <rect x="4" y="4" width="172" height="112" rx="12" fill="#1E293B" stroke="#334155" strokeWidth="1.5" />
                {/* Camera corner guides */}
                <path d="M40 26 V16 H52" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M128 16 H140 V26" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M40 94 V104 H52" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M128 104 H140 V94" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                {/* Flat crisp receipt paper */}
                <rect x="52" y="20" width="76" height="80" rx="4" fill="#FFFFFF" />
                {/* Receipt header & line items */}
                <rect x="66" y="30" width="48" height="5" rx="2" fill="#0F172A" />
                <rect x="62" y="42" width="34" height="3.5" rx="1.5" fill="#94A3B8" />
                <rect x="104" y="42" width="14" height="3.5" rx="1.5" fill="#64748B" />
                <rect x="62" y="51" width="38" height="3.5" rx="1.5" fill="#94A3B8" />
                <rect x="104" y="51" width="14" height="3.5" rx="1.5" fill="#64748B" />
                <rect x="62" y="60" width="30" height="3.5" rx="1.5" fill="#94A3B8" />
                <rect x="104" y="60" width="14" height="3.5" rx="1.5" fill="#64748B" />
                <line x1="60" y1="71" x2="120" y2="71" stroke="#CBD5E1" strokeWidth="1" strokeDasharray="3 2" />
                <rect x="62" y="79" width="24" height="4.5" rx="1.5" fill="#059669" />
                <rect x="98" y="79" width="20" height="4.5" rx="1.5" fill="#059669" />
                {/* Overhead light rays */}
                <circle cx="24" cy="24" r="6" fill="#FBBF24" fillOpacity="0.9" />
                <path d="M24 13 V10 M35 24 H38 M32 32 L35 35 M16 32 L13 35" stroke="#FBBF24" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <p className="mt-2 text-center text-[11px] font-medium text-emerald-300">
              Center all 4 receipt edges inside the green guide
            </p>
          </div>

          <ul className="space-y-3 text-xs text-slate-600 dark:text-slate-400">
            <li className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <Layers className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-100">Flat surface</p>
                <p className="mt-0.5 leading-relaxed">
                  Smooth out creases or curled paper on a flat table so prices and dates stay straight.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <Sun className="h-4 w-4 text-amber-500 dark:text-amber-400" />
              </div>
              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-100">Good lighting</p>
                <p className="mt-0.5 leading-relaxed">
                  Use bright, even lighting and avoid dark shadows or glossy glare over thermal ink.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <Maximize2 className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              </div>
              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-100">Fill the frame</p>
                <p className="mt-0.5 leading-relaxed">
                  Place the receipt on a darker background and move close enough that all 4 corners fit cleanly.
                </p>
              </div>
            </li>
          </ul>
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-900/90">
          <button
            type="button"
            onClick={() => setShowScanTips(false)}
            className="min-h-[44px] w-full rounded-xl bg-slate-900 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const hiddenInputs = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const selectedFile = e.target.files?.[0];
          void handleFileChange(selectedFile, e.currentTarget);
        }}
      />
      <input
        ref={cameraFileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const selectedFile = e.target.files?.[0];
          void handleFileChange(selectedFile, e.currentTarget);
        }}
      />
    </>
  );

  if (isFullScreenCamera) {
    const statusLabel = !isOnline
      ? 'Offline Queue Mode'
      : edgeOverlay?.alignmentHint === 'aligned'
        ? 'Receipt aligned — tap Capture'
        : edgeOverlay?.alignmentHint === 'move_closer'
          ? 'Move closer to receipt'
          : edgeOverlay?.alignmentHint === 'center_receipt'
            ? 'Center all 4 receipt edges'
            : 'Align receipt in frame';

    const quad = edgeOverlay?.quad;
    const strokeColor = edgeOverlay?.isAligned ? '#34d399' : '#fbbf24';
    const fillColor = edgeOverlay?.isAligned
      ? 'rgba(16, 185, 129, 0.12)'
      : 'rgba(251, 191, 36, 0.08)';

    const makeCornerBracket = (
      corner: { x: number; y: number },
      adjA: { x: number; y: number },
      adjB: { x: number; y: number }
    ) => {
      const t = 0.16;
      const ax = (corner.x + (adjA.x - corner.x) * t) * 100;
      const ay = (corner.y + (adjA.y - corner.y) * t) * 100;
      const cx = corner.x * 100;
      const cy = corner.y * 100;
      const bx = (corner.x + (adjB.x - corner.x) * t) * 100;
      const by = (corner.y + (adjB.y - corner.y) * t) * 100;
      return `${ax.toFixed(2)},${ay.toFixed(2)} ${cx.toFixed(2)},${cy.toFixed(2)} ${bx.toFixed(2)},${by.toFixed(2)}`;
    };

    return (
      <div
        ref={viewfinderRef}
        className="fixed inset-0 z-50 overflow-hidden bg-slate-950 text-white"
      >
        {/* Edge-to-edge absolute full-screen live camera stream */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={() => setIsCameraReady(true)}
          onCanPlay={() => setIsCameraReady(true)}
          onPlaying={() => setIsCameraReady(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />

        {/* Real-time computer vision detected receipt boundary overlay */}
        {quad && (
          <svg
            data-testid="receipt-edge-overlay"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 h-full w-full"
          >
            <polygon
              points={`${(quad.topLeft.x * 100).toFixed(2)},${(quad.topLeft.y * 100).toFixed(2)} ${(quad.topRight.x * 100).toFixed(2)},${(quad.topRight.y * 100).toFixed(2)} ${(quad.bottomRight.x * 100).toFixed(2)},${(quad.bottomRight.y * 100).toFixed(2)} ${(quad.bottomLeft.x * 100).toFixed(2)},${(quad.bottomLeft.y * 100).toFixed(2)}`}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={edgeOverlay?.isAligned ? 2.5 : 2}
              strokeDasharray={edgeOverlay?.isAligned ? undefined : '7 5'}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
            <polyline
              points={makeCornerBracket(quad.topLeft, quad.topRight, quad.bottomLeft)}
              fill="none"
              stroke={strokeColor}
              strokeWidth={4}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={makeCornerBracket(quad.topRight, quad.topLeft, quad.bottomRight)}
              fill="none"
              stroke={strokeColor}
              strokeWidth={4}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={makeCornerBracket(quad.bottomRight, quad.topRight, quad.bottomLeft)}
              fill="none"
              stroke={strokeColor}
              strokeWidth={4}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={makeCornerBracket(quad.bottomLeft, quad.topLeft, quad.bottomRight)}
              fill="none"
              stroke={strokeColor}
              strokeWidth={4}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}

        {!isCameraReady && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 bg-slate-950/85 text-white">
            <Loader2 className="h-7 w-7 animate-spin text-emerald-400" />
            <span className="text-xs font-medium text-slate-200">
              Starting full-screen camera...
            </span>
          </div>
        )}

        {/* Top absolute floating controls */}
        <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 bg-gradient-to-b from-slate-950/85 via-slate-950/45 to-transparent px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-6 sm:px-6">
          <button
            type="button"
            onClick={() => setMode('upload')}
            disabled={isBusy}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl bg-white/15 px-3.5 text-sm font-medium text-white backdrop-blur-md transition-colors hover:bg-white/25 whitespace-nowrap"
          >
            <Upload className="h-4 w-4 shrink-0" />
            Upload
          </button>
          <p
            data-testid="camera-alignment-status"
            className={`truncate text-center text-xs font-medium ${
              edgeOverlay?.isAligned ? 'text-emerald-300' : 'text-white/90'
            }`}
          >
            {statusLabel}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShowScanTips(true)}
              disabled={isBusy}
              aria-label="How to scan tips"
              data-testid="scan-tips-button"
              title="How to scan"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white backdrop-blur-md transition-colors hover:bg-white/25"
            >
              <Info className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isBusy}
              aria-label="Close scanner"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white backdrop-blur-md transition-colors hover:bg-white/25"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Absolute floating alerts if any */}
        {(queuedNotice || activeError) && (
          <div className="absolute inset-x-4 top-[72px] z-30 mx-auto max-w-xl space-y-2">
            {queuedNotice && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-400/40 bg-emerald-950/85 p-3 text-xs text-emerald-50 backdrop-blur-md">
                <div className="flex min-w-0 items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span className="truncate font-medium">Saved to offline queue</span>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[36px] shrink-0 rounded-lg bg-emerald-500 px-3 text-xs font-semibold text-white hover:bg-emerald-600 whitespace-nowrap"
                >
                  Done
                </button>
              </div>
            )}

            {activeError && (
              <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-400/40 bg-rose-950/90 p-3 text-xs text-rose-50 backdrop-blur-md">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">Unable to read receipt</p>
                    <p className="mt-0.5 text-rose-200">{activeError}</p>
                  </div>
                </div>
                {lastImage && !isBusy && (
                  <button
                    type="button"
                    onClick={() => onImageReadyForScan(lastImage.dataUrl, lastImage.mimeType)}
                    className="min-h-[36px] shrink-0 rounded-lg bg-white px-2.5 text-xs font-semibold text-rose-900 hover:bg-rose-100 whitespace-nowrap"
                  >
                    Try Again
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Edge-to-edge portrait receipt framing reticle */}
        <div className="pointer-events-none absolute inset-x-4 top-[72px] bottom-[152px] z-10 rounded-2xl border border-white/25 sm:inset-x-8">
          <div className="absolute -left-px -top-px h-7 w-7 rounded-tl-2xl border-l-2 border-t-2 border-emerald-400" />
          <div className="absolute -right-px -top-px h-7 w-7 rounded-tr-2xl border-r-2 border-t-2 border-emerald-400" />
          <div className="absolute -bottom-px -left-px h-7 w-7 rounded-bl-2xl border-b-2 border-l-2 border-emerald-400" />
          <div className="absolute -bottom-px -right-px h-7 w-7 rounded-br-2xl border-b-2 border-r-2 border-emerald-400" />
          {isCameraReady && (
            <div
              data-testid="camera-active-pulse"
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center"
            >
              <div className="relative flex h-16 w-16 items-center justify-center">
                <span className="absolute inset-0 animate-ping rounded-full border-2 border-emerald-400/50" />
                <span className="h-10 w-10 animate-pulse rounded-full border border-emerald-300/75 bg-emerald-400/10" />
                <span className="absolute h-2 w-2 animate-pulse rounded-full bg-emerald-400/90" />
              </div>
            </div>
          )}
        </div>

        {/* Bottom absolute thumb-zone shutter dock */}
        <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-slate-950/95 via-slate-950/75 to-transparent px-4 pt-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="mx-auto w-full max-w-md">
            <button
              type="button"
              onClick={handleCaptureFrame}
              disabled={isBusy}
              aria-label="Capture receipt photo"
              className="flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-2xl bg-emerald-500 px-5 py-3.5 text-base font-semibold text-white shadow-lg shadow-emerald-950/50 transition-all hover:bg-emerald-600 active:scale-[0.98] disabled:opacity-50 whitespace-nowrap"
            >
              <Camera className="h-5 w-5 shrink-0" />
              <span>Capture Receipt</span>
            </button>
            <div className="mt-2.5 flex items-center justify-between gap-1">
              <button
                type="button"
                onClick={() => cameraFileInputRef.current?.click()}
                disabled={isBusy}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10 hover:text-white whitespace-nowrap"
              >
                <Camera className="h-3.5 w-3.5 shrink-0" />
                Device Camera
              </button>
              <button
                type="button"
                data-testid="auto-crop-toggle"
                aria-pressed={autoCropEnabled}
                onClick={() => setAutoCropEnabled((prev) => !prev)}
                disabled={isBusy}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  autoCropEnabled
                    ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Crop className="h-3.5 w-3.5 shrink-0" />
                {autoCropEnabled ? 'Auto-Crop: On' : 'Auto-Crop: Off'}
              </button>
              <button
                type="button"
                onClick={onManualEntry}
                disabled={isBusy}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10 hover:text-white whitespace-nowrap"
              >
                <PenLine className="h-3.5 w-3.5 shrink-0" />
                Manual
              </button>
            </div>
          </div>
        </div>

        {hiddenInputs}
        {scanTipsModal}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-xs sm:items-center sm:p-4">
      <div className="relative flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:max-h-[90dvh] sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5 sm:py-4 dark:border-slate-800">
          <div className="min-w-0 pr-2">
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
              Scan Receipt
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Capture or upload a receipt to extract items and totals automatically.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowScanTips(true)}
              disabled={isBusy}
              aria-label="How to scan tips"
              data-testid="scan-tips-button"
              title="How to scan"
              className="inline-flex h-11 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 whitespace-nowrap dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <Info className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="hidden sm:inline">How to scan</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isBusy}
              aria-label="Close scanner"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
          {/* Mode Switcher */}
          <div className="grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setMode('upload')}
              disabled={isBusy}
              className={`min-h-[44px] rounded-lg px-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 whitespace-nowrap ${
                mode === 'upload'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              <Upload className="h-4 w-4 shrink-0" />
              Upload Image
            </button>
            <button
              type="button"
              onClick={() => setMode('camera')}
              disabled={isBusy}
              className={`min-h-[44px] rounded-lg px-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 whitespace-nowrap ${
                mode === 'camera'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              <Camera className="h-4 w-4 shrink-0" />
              Live Camera
            </button>
          </div>

          {!isOnline && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-200">
              <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-medium">You are currently offline</p>
                <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                  Any receipt photo you capture will be queued locally and scanned with AI once connectivity returns, or you can enter the expense manually below.
                </p>
              </div>
            </div>
          )}

          {queuedNotice && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/50 dark:text-emerald-200">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <p className="font-medium">Receipt saved to offline queue</p>
                  <p className="mt-0.5 text-emerald-800 dark:text-emerald-300">
                    It will be ready to scan once your connection returns. You can capture another receipt or close when done.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900 dark:text-emerald-100 dark:hover:bg-emerald-800"
              >
                Done
              </button>
            </div>
          )}

          {activeError && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-900 dark:border-rose-500/40 dark:bg-rose-950/50 dark:text-rose-200">
              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Unable to read receipt</p>
                  <p className="mt-0.5 text-rose-800 dark:text-rose-300">{activeError}</p>
                </div>
              </div>
              {lastImage && !isBusy && (
                <button
                  type="button"
                  onClick={() => onImageReadyForScan(lastImage.dataUrl, lastImage.mimeType)}
                  className="shrink-0 rounded-lg border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-800 transition-colors hover:bg-rose-100 dark:border-rose-700 dark:bg-rose-900 dark:text-rose-100 dark:hover:bg-rose-800"
                >
                  Try Again
                </button>
              )}
            </div>
          )}

          {isBusy ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 py-16 text-center px-6 dark:border-slate-800 dark:bg-slate-800/50">
              <Loader2 className="h-9 w-9 animate-spin text-emerald-600 dark:text-emerald-400" />
              <p className="mt-4 font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                {isPreparing ? 'Preparing receipt photo...' : 'Extracting receipt details...'}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {isPreparing
                  ? 'Optimizing image resolution for fast OCR scanning'
                  : scanStatus || 'Reading merchant, date, category, and line items'}
              </p>
            </div>
          ) : mode === 'camera' && cameraError ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center dark:border-slate-800 dark:bg-slate-800/50">
              <Camera className="mx-auto h-8 w-8 text-slate-400 dark:text-slate-500" />
              <p className="mt-3 text-sm font-medium text-slate-800 dark:text-slate-200">
                Camera preview unavailable
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{cameraError}</p>
              <button
                type="button"
                onClick={() => cameraFileInputRef.current?.click()}
                className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 whitespace-nowrap dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Camera className="h-4 w-4 shrink-0" />
                Take Photo with Device
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Dropzone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  handleFileChange(e.dataTransfer.files?.[0]);
                }}
                className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-7 text-center transition-colors ${
                  isDragging
                    ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30'
                    : 'border-slate-300 bg-slate-50/60 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-slate-600'
                }`}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-slate-700 shadow-xs border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <FileImage className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
                  Drop a receipt image here, or choose an option
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Supports JPG, PNG, and WebP photos
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                  >
                    <Upload className="h-4 w-4" />
                    Browse Files
                  </button>
                  <button
                    type="button"
                    onClick={() => cameraFileInputRef.current?.click()}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <Camera className="h-4 w-4" />
                    Take Photo
                  </button>
                </div>
              </div>

              {/* Sample Receipts for immediate testing */}
              <div>
                <p className="mb-2.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Or test AI OCR with a sample receipt
                </p>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {SAMPLE_RECEIPTS.map((sample) => (
                    <button
                      key={sample.id}
                      type="button"
                      disabled={loadingSampleId !== null}
                      onClick={() => handleSampleReceipt(sample)}
                      className="flex min-h-[64px] items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-left transition-colors hover:border-emerald-500/60 hover:bg-emerald-50/30 disabled:opacity-60 dark:border-slate-800 dark:bg-slate-800/70 dark:hover:border-emerald-500/60 dark:hover:bg-emerald-950/30"
                    >
                      <img
                        src={sample.imagePath}
                        alt={sample.title}
                        referrerPolicy="no-referrer"
                        className="h-12 w-10 shrink-0 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {sample.title}
                        </p>
                        <p className="font-mono-num truncate text-xs text-slate-500 dark:text-slate-400">
                          {loadingSampleId === sample.id ? 'Loading...' : sample.subtitle}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {hiddenInputs}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2.5 sm:px-5 sm:py-3 dark:border-slate-800 dark:bg-slate-900/90">
          <button
            type="button"
            disabled={isBusy}
            onClick={onManualEntry}
            className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-slate-700 transition-colors hover:text-slate-900 disabled:opacity-40 whitespace-nowrap dark:text-slate-300 dark:hover:text-slate-100"
          >
            <PenLine className="h-4 w-4 shrink-0" />
            Enter manually instead
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            className="min-h-[44px] rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-800 disabled:opacity-40 whitespace-nowrap dark:text-slate-400 dark:hover:text-slate-100"
          >
            Cancel
          </button>
        </div>
      </div>
      {scanTipsModal}
    </div>
  );
};
