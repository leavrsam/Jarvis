// What to show when a camera snapshot doesn't load, from /api/camera's error code.
export function cameraErrorText(camera: string, code: string, detail?: string): string {
  switch (code) {
    case 'not_configured':
      return `Cameras aren't connected: ${detail || 'JARVIS_MEDIA_URL is not set'}. Set it in Vercel (Production), then redeploy.`;
    case 'camera_not_found':
      return `n8n doesn't know a camera called “${camera}”${detail ? ` (${detail})` : ''}.`;
    case 'camera_rejected':
      return 'n8n refused the key: the media webhook must use the same X-Jarvis-Key secret.';
    case 'not_an_image':
      return `n8n answered, but not with an image${detail ? `: ${detail}` : ''}.`;
    case 'camera_unreachable':
      return `Couldn't reach n8n${detail ? `: ${detail}` : ''}.`;
    case 'too_large':
      return 'The snapshot is over 10 MB.';
    case 'bad_camera':
      return `“${camera}” isn't a valid camera name.`;
    default:
      return detail ? `Camera error: ${detail}` : "Couldn't load that camera image.";
  }
}

/** Read /api/camera's error body ({ error, detail }) */
export async function readCameraError(res: Response): Promise<{ code: string; detail?: string }> {
  const body = await res.json().catch(() => ({}));
  return { code: typeof body.error === 'string' ? body.error : `http_${res.status}`, detail: typeof body.detail === 'string' ? body.detail : undefined };
}
