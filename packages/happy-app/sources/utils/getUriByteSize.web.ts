/**
 * Byte size of a file URI — web implementation (blob:/data: URIs from the picker).
 * Returns undefined when the size cannot be determined; callers fall back to
 * picker-reported sizes (the server still enforces the limit on upload).
 */
export async function getUriByteSize(uri: string): Promise<number | undefined> {
    try {
        const response = await fetch(uri);
        if (!response.ok) return undefined;
        const blob = await response.blob();
        return blob.size;
    } catch {
        return undefined;
    }
}
