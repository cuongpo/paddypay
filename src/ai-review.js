import { keccak256 } from 'viem';

export const DEFAULT_AI_MODEL = 'claude-sonnet-5-5';
export const AI_PROMPT_VERSION = 'water-tube-review-v1';
export const PHOTO_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    waterTubeVisible: { type: 'boolean' },
    waterlineVisible: { type: 'boolean' },
    suggestedCm: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    qualityIssues: { type: 'array', items: { type: 'string', enum: ['blur', 'glare', 'occlusion', 'no_scale', 'no_zero_reference', 'other'] } },
    explanation: { type: 'string' },
  },
  required: ['waterTubeVisible', 'waterlineVisible', 'suggestedCm', 'confidence', 'qualityIssues', 'explanation'],
  additionalProperties: false,
};

const mediaTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const qualityIssues = new Set(PHOTO_REVIEW_SCHEMA.properties.qualityIssues.items.enum);

export function validatePhotoInput(input) {
  if (!input || !mediaTypes.has(input.mediaType) || typeof input.base64 !== 'string' || input.base64.length > 7_000_000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) throw new Error('Unsupported image');
  const bytes = Buffer.from(input.base64, 'base64');
  if (bytes.length < 1 || bytes.length > 5_000_000) throw new Error('Image must be 1 byte to 5 MB');
  return { bytes, imageHash: keccak256(bytes) };
}

export function assessPhotoReading(reading, sensorCm) {
  if (!reading || typeof reading.waterTubeVisible !== 'boolean' || typeof reading.waterlineVisible !== 'boolean' ||
      !['high', 'medium', 'low'].includes(reading.confidence) || !Array.isArray(reading.qualityIssues) ||
      reading.qualityIssues.some(issue => !qualityIssues.has(issue)) || typeof reading.explanation !== 'string') {
    throw new Error('Vision service returned an invalid assessment');
  }
  const reliableReference = !reading.qualityIssues.includes('no_scale') && !reading.qualityIssues.includes('no_zero_reference');
  const suggestedCm = reliableReference && reading.waterTubeVisible && reading.waterlineVisible && Number.isInteger(reading.suggestedCm) && reading.suggestedCm >= -50 && reading.suggestedCm <= 50 ? reading.suggestedCm : null;
  const readable = reading.waterTubeVisible && reading.waterlineVisible && suggestedCm !== null;
  const deltaCm = readable && Number.isInteger(sensorCm) ? Math.abs(suggestedCm - sensorCm) : null;
  const reasons = [];
  if (!readable) reasons.push('The water level cannot be read reliably from this photo.');
  if (reading.confidence === 'low') reasons.push('The AI reported low reading confidence.');
  if (reading.qualityIssues.length) reasons.push(`Photo quality: ${reading.qualityIssues.join(', ').replaceAll('_', ' ')}.`);
  if (!Number.isInteger(sensorCm)) reasons.push('No signed cluster reading is available for this day.');
  if (deltaCm !== null && deltaCm > 10) reasons.push(`The AI suggestion differs from the shared cluster sensor by ${deltaCm} cm (over the 10 cm review threshold).`);
  const recommendation = !readable ? 'unreadable' : reasons.length ? 'needs_review' : 'human_confirmation';
  return {
    ai: {
      suggestedCm, confidence: reading.confidence, waterTubeVisible: reading.waterTubeVisible,
      waterlineVisible: reading.waterlineVisible, qualityIssues: reading.qualityIssues,
      explanation: reading.explanation.slice(0, 500),
    },
    comparison: { sensorCm: Number.isInteger(sensorCm) ? sensorCm : null, deltaCm, sharedCluster: true },
    recommendation, reasons, requiresConfirmation: true,
  };
}

export async function reviewPhotoWithAI({ input, sensorCm, apiKey, model = DEFAULT_AI_MODEL, fetcher = fetch }) {
  const { imageHash } = validatePhotoInput(input);
  const prompt = `Screen this one user-uploaded rice-field water-tube photo. Read the water level in whole centimeters relative to the visible field-surface zero mark: negative means below the surface. Return null if the tube, waterline, scale, or zero reference does not support a reliable number. Report visible image quality problems. Confidence is a qualitative self-assessment, not a calibrated probability. Do not infer the plot, date, location, device signature, carbon savings, or payment from the image. Keep the explanation short and factual.`;
  const response = await fetcher('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model, max_tokens: 1024,
      ...(model === 'claude-sonnet-5-5' ? { thinking: { type: 'between_tools' } } : {}),
      output_config: { format: { type: 'json_schema', schema: PHOTO_REVIEW_SCHEMA } },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.base64 } },
        { type: 'text', text: prompt },
      ] }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Vision service failed: ${result.error?.message ?? 'unknown error'}`);
  const output = result.content?.filter(part => part.type === 'text').map(part => part.text).join('') ?? '';
  let reading;
  try { reading = JSON.parse(output); }
  catch { throw new Error('Vision service returned unreadable JSON'); }
  return { imageHash, model, promptVersion: AI_PROMPT_VERSION, ...assessPhotoReading(reading, sensorCm) };
}
