// src/supabase/client.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

// Create and export a single Supabase client instance
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Export avatar upload functionality
export const uploadAvatar = async (file) => {
  try {
    console.log('Starting upload process for file:', file.name);

    // Validate file type
    if (!file.type.startsWith('image/')) {
      throw new Error('Please upload an image file');
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      throw new Error('Image size should be less than 2MB');
    }

    const fileExt = file.type.split('/')[1];
    // Use only one level of folder structure
    const fileName = `${Date.now()}-${Math.random()}.${fileExt}`;
    const filePath = fileName; // Remove the avatars/ prefix since bucket is already 'avatars'

    console.log('Attempting upload to path:', filePath);

    const { error: uploadError, data } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: file.type
      });

    if (uploadError) {
      console.error('Upload error details:', uploadError);
      throw uploadError;
    }

    console.log('Upload successful, data:', data);

    // Get the public URL
    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    console.log('Generated public URL:', publicUrl);
    return publicUrl;

  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};

export { supabase };
