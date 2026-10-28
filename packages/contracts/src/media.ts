export interface MessageMediaRef {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  index: number;
  name?: string;
}
export interface ContentPart {
  type: string;
  text?: string;
  image_url?: { url: string; detail?: string };
  video_url?: { url: string };
}
export function textContent(content: string | ContentPart[] | null | undefined): string {
  return typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => (part.type === 'text' ? (part.text ?? '') : `[${part.type}]`)).join('\n')
      : '';
}
