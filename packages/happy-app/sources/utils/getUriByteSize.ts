/**
 * Byte size of a file URI — native implementation.
 * Returns undefined when the size cannot be determined; callers fall back to
 * picker-reported sizes (the server still enforces the limit on upload).
 */
import { getInfoAsync } from 'expo-file-system/legacy';

export async function getUriByteSize(uri: string): Promise<number | undefined> {
    try {
        const info = await getInfoAsync(uri);
        return info.exists && typeof info.size === 'number' ? info.size : undefined;
    } catch {
        return undefined;
    }
}
