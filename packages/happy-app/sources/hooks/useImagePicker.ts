/**
 * Image picker hook for attaching images to messages.
 *
 * Wraps expo-image-picker with permission handling and thumbhash generation.
 * Enforces limits: max 20 images per message, 10MB per file.
 *
 * Note: fileSize from expo-image-picker is optional — some platforms do not
 * provide it. The size gate therefore measures the byte size of the file that
 * will actually be uploaded (iOS re-encodes to JPEG first); only when neither
 * a measured size nor fileSize is available does a file pass the client-side
 * check, and the server enforces the limit on upload.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { Modal } from '@/modal';
import { generateThumbhash } from '@/utils/thumbhash';
import { getUriByteSize } from '@/utils/getUriByteSize';
import { t } from '@/text';
import type { AttachmentPreview } from '@/sync/attachmentTypes';

export const MAX_IMAGES_PER_MESSAGE = 20;
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const IOS_ATTACHMENT_JPEG_QUALITY = 0.92;

export type { AttachmentPreview };

type UseImagePickerResult = {
    selectedImages: AttachmentPreview[];
    pickImages: () => Promise<void>;
    removeImage: (id: string) => void;
    clearImages: () => void;
    addImages: (images: AttachmentPreview[]) => void;
};

function withJpegExtension(fileName: string | null | undefined): string {
    const fallback = `image_${Date.now()}.jpg`;
    const name = fileName?.trim() || fallback;
    const extensionIndex = name.lastIndexOf('.');
    const stem = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
    return `${stem}.jpg`;
}

export async function normalizePickedAssetForUpload(asset: ImagePicker.ImagePickerAsset): Promise<{
    uri: string;
    width: number;
    height: number;
    mimeType: string;
    name: string;
}> {
    if (Platform.OS !== 'ios') {
        return {
            uri: asset.uri,
            width: asset.width,
            height: asset.height,
            mimeType: asset.mimeType ?? 'image/jpeg',
            name: asset.fileName ?? `image_${Date.now()}.jpg`,
        };
    }

    const converted = await manipulateAsync(asset.uri, [], {
        compress: IOS_ATTACHMENT_JPEG_QUALITY,
        format: SaveFormat.JPEG,
    });

    return {
        uri: converted.uri,
        width: converted.width || asset.width,
        height: converted.height || asset.height,
        mimeType: 'image/jpeg',
        name: withJpegExtension(asset.fileName),
    };
}

export type ProcessedPickedAssets = {
    previews: AttachmentPreview[];
    /** Display names of assets rejected for exceeding MAX_FILE_SIZE. */
    tooLarge: string[];
    /** Count of assets that could not be read or converted at all. */
    unreadable: number;
};

export async function processPickedAssets(assets: ImagePicker.ImagePickerAsset[]): Promise<ProcessedPickedAssets> {
    const previews: AttachmentPreview[] = [];
    const tooLarge: string[] = [];
    let unreadable = 0;

    for (const asset of assets) {
        let normalized: Awaited<ReturnType<typeof normalizePickedAssetForUpload>>;
        try {
            normalized = await normalizePickedAssetForUpload(asset);
        } catch (err) {
            // Unreadable container (e.g. DNG/RAW from third-party camera apps);
            // skip it without killing the rest of the batch.
            console.error('[useImagePicker] Failed to prepare image for attaching:', err);
            unreadable++;
            continue;
        }

        // Gate on the size of the file that will actually be uploaded: iOS
        // re-encodes to JPEG above, and asset.fileSize may be absent entirely
        // (third-party camera apps) — defaulting it to 0 would skip the gate.
        const size = (await getUriByteSize(normalized.uri)) ?? asset.fileSize ?? 0;
        if (size > MAX_FILE_SIZE) {
            tooLarge.push(asset.fileName ?? normalized.name);
            continue;
        }

        // Skip thumbhash if dimensions are unavailable (prevents divide-by-zero).
        let thumbhash: string | undefined;
        if (normalized.width > 0 && normalized.height > 0) {
            try {
                thumbhash = await generateThumbhash(normalized.uri, normalized.width, normalized.height);
            } catch (err) {
                // Thumbhash is a nicety — attach the image without one.
                console.error('[useImagePicker] Failed to generate thumbhash:', err);
            }
        }

        previews.push({
            id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
            uri: normalized.uri,
            width: normalized.width,
            height: normalized.height,
            mimeType: normalized.mimeType,
            size,
            name: normalized.name,
            thumbhash,
        });
    }

    return { previews, tooLarge, unreadable };
}

export function useImagePicker(): UseImagePickerResult {
    const [selectedImages, setSelectedImages] = useState<AttachmentPreview[]>([]);
    // Ref tracks current count to avoid stale closures on rapid taps.
    const selectedCountRef = useRef(0);
    useEffect(() => {
        selectedCountRef.current = selectedImages.length;
    }, [selectedImages]);

    const requestPermission = useCallback(async (): Promise<boolean> => {
        if (Platform.OS === 'web') return true;

        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            Modal.alert(
                t('imageUpload.permissionTitle'),
                t('imageUpload.permissionMessage'),
                [{ text: t('common.ok') }],
            );
            return false;
        }
        return true;
    }, []);

    const pickImages = useCallback(async () => {
        const remaining = MAX_IMAGES_PER_MESSAGE - selectedCountRef.current;
        if (remaining <= 0) {
            Modal.alert(
                t('imageUpload.limitTitle'),
                t('imageUpload.limitMessage', { max: MAX_IMAGES_PER_MESSAGE }),
                [{ text: t('common.ok') }],
            );
            return;
        }

        const options: ImagePicker.ImagePickerOptions = {
            mediaTypes: ['images'], // expo-image-picker ~55: MediaTypeOptions deprecated
            allowsMultipleSelection: true,
            selectionLimit: remaining,
            quality: 1, // request full-resolution source; iOS upload is normalized below
            exif: false,
        };

        // Order matters on web: WebKit only opens the file dialog while the
        // press that triggered it still counts as the active user gesture, and
        // a single await is enough to lose that on iOS. So launch first and
        // never await ahead of it — permissions are a no-op on web anyway.
        const isWeb = Platform.OS === 'web';
        const pending = isWeb ? ImagePicker.launchImageLibraryAsync(options) : null;

        if (!isWeb && !(await requestPermission())) return;

        const result = await (pending ?? ImagePicker.launchImageLibraryAsync(options));

        if (result.canceled || !result.assets.length) return;

        // On web, selectionLimit is not enforced by the browser — clamp here.
        const assets = result.assets.slice(0, remaining);
        const { previews, tooLarge, unreadable } = await processPickedAssets(assets);

        for (const name of tooLarge) {
            Modal.alert(
                t('imageUpload.fileTooLargeTitle'),
                t('imageUpload.fileTooLargeMessage', { name, maxMb: 10 }),
                [{ text: t('common.ok') }],
            );
        }

        if (unreadable > 0) {
            Modal.alert(
                t('imageUpload.processingFailedTitle'),
                t('imageUpload.processingFailedMessage', { count: unreadable }),
                [{ text: t('common.ok') }],
            );
        }

        if (previews.length > 0) {
            setSelectedImages(prev => [...prev, ...previews].slice(0, MAX_IMAGES_PER_MESSAGE));
        }
    }, [requestPermission]);

    const removeImage = useCallback((id: string) => {
        setSelectedImages(prev => prev.filter(img => img.id !== id));
    }, []);

    const clearImages = useCallback(() => {
        setSelectedImages([]);
    }, []);

    const addImages = useCallback((images: AttachmentPreview[]) => {
        setSelectedImages(prev => {
            const remaining = MAX_IMAGES_PER_MESSAGE - prev.length;
            if (remaining <= 0) return prev;
            return [...prev, ...images.slice(0, remaining)];
        });
    }, []);

    return { selectedImages, pickImages, removeImage, clearImages, addImages };
}
