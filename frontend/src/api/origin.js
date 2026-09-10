import { resolveApiOrigin } from '../../config/apiOrigin.mjs';

export const API_ORIGIN = resolveApiOrigin(import.meta.env.VITE_API_BASE_URL, import.meta.env.DEV);
