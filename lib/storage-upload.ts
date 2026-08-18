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
