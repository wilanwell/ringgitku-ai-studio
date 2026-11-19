import 'dotenv/config';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

const VALID_CATEGORIES = [
  'Food & Dining',
  'Groceries',
  'Utilities',
  'Transport',
  'Shopping',
  'Healthcare',
  'Entertainment',
  'Other',
] as const;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 22_000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '30mb' }));

  app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    next();
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/receipts/scan', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    try {
      const { imageBase64, mimeType } = req.body as {
        imageBase64?: string;
        mimeType?: string;
      };

      if (!imageBase64 || typeof imageBase64 !== 'string') {
        res.status(400).json({ error: 'Receipt image data is required.' });
        return;
      }

      const cleanedBase64 = imageBase64.includes(',')
        ? imageBase64.split(',')[1]
        : imageBase64;
      const decodedBytes = Buffer.from(cleanedBase64, 'base64').length;
      if (decodedBytes < 64) {
        res.status(400).json({ error: 'Receipt image payload is empty or corrupted.' });
        return;
      }

      const safeMimeType =
        typeof mimeType === 'string' && mimeType.startsWith('image/')
          ? mimeType
          : 'image/jpeg';

      const ai = getGeminiClient();

      const prompt = `Examine this receipt image and extract accurate structured expense data.
Rules:
1. Extract the store or merchant name cleanly in title case (e.g., "Roastery & Co.", "Greenleaf Market").
2. Extract the transaction date in YYYY-MM-DD format. If the year is missing or unclear, assume the current year ${new Date().getFullYear()}. If no date is printed, use today's date ${new Date().toISOString().slice(0, 10)}.
3. Choose the single best category from: ${VALID_CATEGORIES.join(', ')}.
4. Extract every line item with its name, numeric quantity (default 1), and total line price as a number.
5. Extract subtotal, tax, and final total as numbers. If subtotal or tax is not printed, set them to 0 or infer cleanly so total matches the receipt total.
6. Extract payment method if visible (e.g., "Visa •••• 4821", "Cash", "Apple Pay"), otherwise return "".
7. Set confidence to "high", "medium", or "low" based on text legibility.`;

      const generateReceiptExtraction = () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        return ai.models
          .generateContent({
            model: 'gemini-3.5-flash-lite',
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: safeMimeType,
                    data: cleanedBase64,
                  },
                },
                {
                  text: prompt,
                },
              ],
            },
            config: {
              abortSignal: controller.signal,
              systemInstruction:
                'You are a precision financial receipt OCR parser. Always return strictly valid JSON matching the schema with accurate numeric totals and normalized categories.',
              thinkingConfig: {
                thinkingLevel: ThinkingLevel.LOW,
              },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  merchant: {
                    type: Type.STRING,
                    description: 'Merchant or store name on the receipt.',
                  },
                  date: {
                    type: Type.STRING,
                    description: 'Transaction date formatted as YYYY-MM-DD.',
                  },
                  currency: {
                    type: Type.STRING,
                    description: 'Three-letter ISO currency code, e.g. MYR. Default to MYR unless another currency is clearly printed.',
                  },
                  category: {
                    type: Type.STRING,
                    description: `Expense category: one of ${VALID_CATEGORIES.join(', ')}.`,
                  },
                  subtotal: {
                    type: Type.NUMBER,
                    description: 'Receipt subtotal before tax.',
                  },
                  tax: {
                    type: Type.NUMBER,
                    description: 'Tax amount on receipt.',
                  },
                  total: {
                    type: Type.NUMBER,
                    description: 'Final total amount paid.',
                  },
                  paymentMethod: {
                    type: Type.STRING,
                    description: 'Payment method if printed on receipt, else empty string.',
                  },
                  confidence: {
                    type: Type.STRING,
                    description: 'OCR confidence level: high, medium, or low.',
                  },
                  notes: {
                    type: Type.STRING,
                    description: 'Optional short summary or receipt address/transaction reference.',
                  },
                  items: {
                    type: Type.ARRAY,
                    description: 'Extracted line items from the receipt.',
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        name: { type: Type.STRING },
                        quantity: { type: Type.NUMBER },
                        price: { type: Type.NUMBER },
                      },
                      required: ['name', 'quantity', 'price'],
                    },
                  },
                },
                required: [
                  'merchant',
                  'date',
                  'currency',
                  'category',
                  'subtotal',
                  'tax',
                  'total',
                  'items',
                ],
              },
            },
          })
          .finally(() => clearTimeout(timer));
      };

      let response;
      try {
        response = await generateReceiptExtraction();
      } catch (upstreamErr) {
        const errStatus = (upstreamErr as { status?: number }).status;
        const elapsed = Date.now() - startedAt;
        if (errStatus && errStatus >= 500 && elapsed < 6_000) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          response = await generateReceiptExtraction();
        } else {
          throw upstreamErr;
        }
      }

      console.log(`Receipt scan completed in ${Date.now() - startedAt}ms (${decodedBytes} bytes)`);

      let rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Empty response from receipt scanner model.' });
        return;
      }

      if (rawText.startsWith('```')) {
        rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      }

      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      const category = VALID_CATEGORIES.includes(parsed.category as (typeof VALID_CATEGORIES)[number])
        ? (parsed.category as string)
        : 'Other';

      res.json({
        merchant: typeof parsed.merchant === 'string' && parsed.merchant.trim() ? parsed.merchant.trim() : 'Unknown Merchant',
        date: typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
          ? parsed.date
          : new Date().toISOString().slice(0, 10),
        currency: typeof parsed.currency === 'string' && parsed.currency ? parsed.currency : 'MYR',
        category,
        subtotal: Number(parsed.subtotal) || 0,
        tax: Number(parsed.tax) || 0,
        total: Number(parsed.total) || 0,
        paymentMethod: typeof parsed.paymentMethod === 'string' ? parsed.paymentMethod : '',
        confidence: parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
          ? parsed.confidence
          : 'medium',
        notes: typeof parsed.notes === 'string' ? parsed.notes : '',
        items: Array.isArray(parsed.items)
          ? parsed.items.map((item: unknown) => {
              const row = item as Record<string, unknown>;
              return {
                name: typeof row.name === 'string' ? row.name : 'Item',
                quantity: Number(row.quantity) || 1,
                price: Number(row.price) || 0,
              };
            })
          : [],
      });
    } catch (err) {
      const error = err as { status?: number; message?: string; name?: string };
      console.error('Receipt scan error:', error);
      const statusCode =
        error.name === 'AbortError'
          ? 504
          : error.status && error.status >= 400 && error.status < 600
            ? error.status
            : 500;

      let cleanDetail = error.message || 'Failed to scan receipt image.';
      if (cleanDetail.trim().startsWith('{')) {
        try {
          const parsedErr = JSON.parse(cleanDetail) as { error?: { message?: string } };
          if (parsedErr?.error?.message) {
            cleanDetail = parsedErr.error.message;
          }
        } catch {
          // Keep original error message
        }
      }

      const message =
        statusCode === 403 || statusCode === 400
          ? 'Receipt OCR failed due to API key permissions or invalid image input. Please check Settings > Secrets.'
          : statusCode === 429
            ? 'Receipt OCR rate limit reached. Please try again in a moment.'
            : statusCode === 504
              ? 'Receipt OCR timed out while waiting for the AI service. Please try again.'
              : cleanDetail;
      res.status(statusCode).json({ error: message });
    }
  });

  // Never let unknown /api/* routes fall through to SPA HTML or Express HTML error pages
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api')) {
      next(err);
      return;
    }
    const apiErr = err as { status?: number; statusCode?: number; type?: string; message?: string };
    if (apiErr.type === 'entity.too.large' || apiErr.status === 413) {
      res.status(413).json({
        error: 'Receipt image is too large. Please try a smaller or lower-resolution photo.',
      });
      return;
    }
    const status = apiErr.statusCode || apiErr.status || 500;
    res.status(status).json({
      error: apiErr.message || 'Server error while processing receipt.',
    });
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr:
          process.env.DISABLE_HMR === 'true'
            ? false
            : {
                server: httpServer,
              },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`RinggitKu server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
