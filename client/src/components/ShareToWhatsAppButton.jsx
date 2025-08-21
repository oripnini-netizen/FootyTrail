import React, { useState } from 'react';
import { toPng } from 'html-to-image';
import supabase from '../supabase';

/**
 * ShareToWhatsAppButton
 *
 * Props:
 * - cardRef: React ref to the DOM node of the game card to capture
 * - shareText: string shown in the WhatsApp message
 *
 * How it works:
 * 1) Renders the referenced element to PNG (html-to-image)
 * 2) If Web Share API supports files -> share the PNG directly (best UX)
 * 3) Else uploads PNG to Supabase Storage bucket "shares" and opens wa.me with the public URL
 * 4) Final fallback: downloads the image locally for manual sharing
 */
export default function ShareToWhatsAppButton({ cardRef, shareText = 'I just played FootyTrail!' }) {
  const [busy, setBusy] = useState(false);

  const dataUrlToFile = async (dataUrl, filename) => {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], filename, { type: 'image/png' });
  };

  const captureCard = async () => {
    const node = cardRef?.current;
    if (!node) throw new Error('Game card element not found');
    // Increase pixelRatio for sharper image; set bg to white to avoid transparent PNG on dark mode
    return await toPng(node, { pixelRatio: 2, cacheBust: true, backgroundColor: '#ffffff' });
  };

  const uploadToSupabase = async (file) => {
    // Try to get user id for a tidy path; ok if not logged in
    let userId = 'anon';
    try {
      const { data, error } = await supabase.auth.getUser();
      if (!error && data?.user?.id) userId = data.user.id;
    } catch (_) {
      /* ignore */
    }

    const path = `whatsapp/${userId}/${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage
      .from('shares')
      .upload(path, file, { contentType: 'image/png', upsert: true });
    if (uploadError) throw uploadError;

    const { data: pub } = supabase.storage.from('shares').getPublicUrl(path);
    return pub?.publicUrl;
  };

  const handleShare = async () => {
    if (busy) return;
    setBusy(true);

    try {
      const dataUrl = await captureCard();
      const file = await dataUrlToFile(dataUrl, `footytrail-${Date.now()}.png`);

      // 1) Best path: native share with file (mobile)
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ text: shareText, files: [file] });
        setBusy(false);
        return;
      }

      // 2) Fallback: upload to Supabase, then share wa.me link with the public image URL
      let publicUrl = '';
      try {
        publicUrl = await uploadToSupabase(file);
      } catch (e) {
        console.warn('Supabase upload failed, falling back to download.', e);
      }

      const text = `${shareText}${publicUrl ? `\n${publicUrl}` : ''}`.trim();
      const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank', 'noopener,noreferrer');

      // 3) Last resort: download the image if no new tab opened (pop-up blockers, etc.)
      if (!publicUrl && document.hasFocus()) {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `footytrail-${Date.now()}.png`;
        a.click();
        alert('Could not share directly. Image downloaded—send it via WhatsApp manually.');
      }
    } catch (err) {
      console.error('Share failed:', err);
      alert('Sorry—something went wrong preparing the share image.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={handleShare}
      disabled={busy}
      className="px-4 py-2 rounded-xl bg-green-600 text-white font-semibold shadow disabled:opacity-60"
      aria-label="Share to WhatsApp"
      title="Share to WhatsApp"
    >
      {busy ? 'Preparing…' : 'Share to WhatsApp'}
    </button>
  );
}
