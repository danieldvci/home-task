import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from './firebase';
import { compressImage } from './image';

export async function uploadTaskProof(
  householdId: string,
  logId: string,
  file: File
): Promise<string> {
  const compressed = await compressImage(file);
  const path = `households/${householdId}/proofs/${logId}.jpg`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, compressed, {
    contentType: 'image/jpeg',
    cacheControl: 'public,max-age=31536000'
  });
  return getDownloadURL(storageRef);
}

const MAX_AVATAR_SOURCE_BYTES = 8 * 1024 * 1024;

export function validateAvatarFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'יש לבחור קובץ תמונה';
  if (file.size > MAX_AVATAR_SOURCE_BYTES) return 'התמונה גדולה מדי (מקסימום 8MB)';
  return null;
}

export async function uploadUserAvatar(
  householdId: string,
  userId: string,
  file: File
): Promise<string> {
  const compressed = await compressImage(file, 512, 0.85);
  const path = `households/${householdId}/avatars/${userId}.jpg`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, compressed, {
    contentType: 'image/jpeg',
    cacheControl: 'public,max-age=31536000'
  });
  return getDownloadURL(storageRef);
}
