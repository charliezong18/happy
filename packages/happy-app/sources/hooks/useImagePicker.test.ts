import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    platform: { OS: 'ios' },
    requestMediaLibraryPermissionsAsync: vi.fn(),
    launchImageLibraryAsync: vi.fn(),
    manipulateAsync: vi.fn(),
    generateThumbhash: vi.fn(),
    getUriByteSize: vi.fn(),
}));

vi.mock('react-native', () => ({
    Platform: mocks.platform,
}));

vi.mock('expo-image-picker', () => ({
    requestMediaLibraryPermissionsAsync: mocks.requestMediaLibraryPermissionsAsync,
    launchImageLibraryAsync: mocks.launchImageLibraryAsync,
}));

vi.mock('expo-image-manipulator', () => ({
    SaveFormat: { JPEG: 'jpeg' },
    manipulateAsync: mocks.manipulateAsync,
}));

vi.mock('@/modal', () => ({
    Modal: { alert: vi.fn() },
}));

vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

vi.mock('@/utils/thumbhash', () => ({
    generateThumbhash: mocks.generateThumbhash,
}));

vi.mock('@/utils/getUriByteSize', () => ({
    getUriByteSize: mocks.getUriByteSize,
}));

import { normalizePickedAssetForUpload, processPickedAssets } from './useImagePicker';

describe('normalizePickedAssetForUpload', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.platform.OS = 'ios';
    });

    it('normalizes iOS image picker assets to JPEG before upload', async () => {
        mocks.manipulateAsync.mockResolvedValue({
            uri: 'file:///tmp/ImageManipulator/IMG_9824.jpg',
            width: 4032,
            height: 3024,
        });

        const normalized = await normalizePickedAssetForUpload({
            uri: 'file:///tmp/IMG_9824.HEIC',
            width: 4032,
            height: 3024,
            fileName: 'IMG_9824.HEIC',
            fileSize: 2_701_533,
        });

        expect(mocks.manipulateAsync).toHaveBeenCalledWith(
            'file:///tmp/IMG_9824.HEIC',
            [],
            { compress: expect.any(Number), format: 'jpeg' },
        );
        expect(normalized).toEqual({
            uri: 'file:///tmp/ImageManipulator/IMG_9824.jpg',
            mimeType: 'image/jpeg',
            name: 'IMG_9824.jpg',
            width: 4032,
            height: 3024,
        });
    });
});

describe('processPickedAssets', () => {
    const converted = {
        uri: 'file:///tmp/ImageManipulator/converted.jpg',
        width: 4032,
        height: 3024,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.platform.OS = 'ios';
    });

    it('rejects an oversized asset even when the picker reports no fileSize', async () => {
        mocks.manipulateAsync.mockResolvedValue(converted);
        mocks.getUriByteSize.mockResolvedValue(25 * 1024 * 1024);

        const result = await processPickedAssets([
            { uri: 'file:///tmp/third-party.heic', width: 8000, height: 6000, fileName: 'third-party.heic' },
        ]);

        expect(result.previews).toEqual([]);
        expect(result.tooLarge).toEqual(['third-party.heic']);
        expect(result.unreadable).toBe(0);
    });

    it('accepts an asset whose converted output fits the limit even if the original was larger', async () => {
        mocks.manipulateAsync.mockResolvedValue(converted);
        mocks.getUriByteSize.mockResolvedValue(4 * 1024 * 1024);
        mocks.generateThumbhash.mockResolvedValue('hash');

        const result = await processPickedAssets([
            { uri: 'file:///tmp/IMG_1.HEIC', width: 4032, height: 3024, fileName: 'IMG_1.HEIC', fileSize: 30 * 1024 * 1024 },
        ]);

        expect(result.tooLarge).toEqual([]);
        expect(result.unreadable).toBe(0);
        expect(result.previews).toHaveLength(1);
        expect(result.previews[0].uri).toBe(converted.uri);
        expect(result.previews[0].size).toBe(4 * 1024 * 1024);
    });

    it('keeps processing the batch when one asset cannot be converted', async () => {
        mocks.manipulateAsync
            .mockRejectedValueOnce(new Error('unsupported container'))
            .mockResolvedValueOnce(converted);
        mocks.getUriByteSize.mockResolvedValue(1024);
        mocks.generateThumbhash.mockResolvedValue('hash');

        const result = await processPickedAssets([
            { uri: 'file:///tmp/broken.dng', width: 100, height: 100, fileName: 'broken.dng' },
            { uri: 'file:///tmp/good.heic', width: 200, height: 300, fileName: 'good.heic' },
        ]);

        expect(result.unreadable).toBe(1);
        expect(result.tooLarge).toEqual([]);
        expect(result.previews).toHaveLength(1);
        expect(result.previews[0].name).toBe('good.jpg');
    });

    it('falls back to the picker-reported fileSize when the real size cannot be measured', async () => {
        mocks.platform.OS = 'android';
        mocks.getUriByteSize.mockResolvedValue(undefined);
        mocks.generateThumbhash.mockResolvedValue('hash');

        const result = await processPickedAssets([
            { uri: 'file:///tmp/big.jpg', width: 10, height: 10, fileName: 'big.jpg', fileSize: 11 * 1024 * 1024 },
            { uri: 'file:///tmp/small.jpg', width: 10, height: 10, fileName: 'small.jpg', fileSize: 1024 },
        ]);

        expect(result.tooLarge).toEqual(['big.jpg']);
        expect(result.previews).toHaveLength(1);
        expect(result.previews[0].name).toBe('small.jpg');
    });

    it('still attaches the image when thumbhash generation fails', async () => {
        mocks.platform.OS = 'android';
        mocks.getUriByteSize.mockResolvedValue(1024);
        mocks.generateThumbhash.mockRejectedValue(new Error('bad bitmap'));

        const result = await processPickedAssets([
            { uri: 'file:///tmp/ok.png', width: 10, height: 10, fileName: 'ok.png', mimeType: 'image/png' },
        ]);

        expect(result.previews).toHaveLength(1);
        expect(result.previews[0].thumbhash).toBeUndefined();
    });
});
