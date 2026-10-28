import { Action } from '@qq-harness/client-sdk';
import { useEffect, useState } from 'react';
import { Drawer, useHost } from '@qq-harness/client-sdk';
import type { StoredMessage, MessageMediaRef } from '@qq-harness/contracts';

export function hasImages(message: StoredMessage) {
  return imageCount(message) > 0;
}
export function imageCount(message: StoredMessage) {
  const value = message.metadata ?? {};
  const outbound = value.outbound as { segments?: { type: string }[] } | undefined;
  const parts = (value.segments ?? outbound?.segments ?? value.media) as
    { type?: string; kind?: string }[] | undefined;
  const count = parts?.filter((p) => p.type === 'image' || p.kind === 'image').length ?? 0;
  return count || (message.text.match(/\[image\]|\[图片[^\]]*\]/gi)?.length ?? 0);
}
export function ImagePreview({ message, close }: { message: StoredMessage; close: () => void }) {
  const host = useHost(),
    [images, setImages] = useState<MessageMediaRef[]>([]),
    [index, setIndex] = useState(0),
    [source, setSource] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [zoom, setZoom] = useState(1),
    [retry, setRetry] = useState(0);
  const path = `/api/message-media/${encodeURIComponent(message.chatKey)}/${message.localId}`;
  useEffect(() => {
    const abort = new AbortController();
    void host.api
      .request<MessageMediaRef[]>(path + (retry ? '?refresh=1' : ''), {
        signal: abort.signal,
      })
      .then((rows) => {
        const list = rows.filter((row) => row.kind === 'image');
        setImages(list);
        if (!list.length) {
          setError('该记录没有可用的图片来源');
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [path, retry]);
  useEffect(() => {
    const item = images[index];
    if (!item) return;
    const abort = new AbortController();
    let url = '';
    setLoading(true);
    setSource('');
    setError('');
    setZoom(1);
    void host.api
      .blob(`${path}/${item.index}`, { signal: abort.signal })
      .then((blob) => {
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setSource(url);
        setLoading(false);
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [images, index, path, retry]);
  return (
    <Drawer title="图片预览" onClose={close} className="media-drawer">
      <div className="media-toolbar">
        <span>
          {message.senderName || message.senderId} · {new Date(message.timestamp).toLocaleString()}
        </span>
        <div className="row">
          <Action disabled={index === 0} onClick={() => setIndex(index - 1)}>
            上一张
          </Action>
          <span>
            {images.length ? index + 1 : 0} / {images.length}
          </span>
          <Action disabled={index + 1 >= images.length} onClick={() => setIndex(index + 1)}>
            下一张
          </Action>
          <Action onClick={() => setZoom(Math.max(0.25, zoom - 0.25))}>缩小</Action>
          <Action onClick={() => setZoom(Math.min(4, zoom + 0.25))}>放大</Action>
          <Action onClick={() => setZoom(1)}>适应窗口</Action>
          <Action onClick={() => setZoom(0)}>原尺寸</Action>
        </div>
      </div>
      <div className="image-stage">
        {loading ? (
          <div className="empty">正在读取图片…</div>
        ) : error ? (
          <div className="media-error" role="alert">
            <p>{error}</p>
            <Action onClick={() => setRetry(retry + 1)}>重新加载</Action>
          </div>
        ) : source ? (
          <img
            alt={`消息图片 ${index + 1}`}
            src={source}
            style={
              zoom
                ? {
                    maxWidth: '100%',
                    maxHeight: '76vh',
                    transform: `scale(${zoom})`,
                    transformOrigin: 'center',
                  }
                : { maxWidth: 'none', maxHeight: 'none' }
            }
            onError={() => setError('图片无法解码，请重新加载')}
          />
        ) : null}
      </div>
    </Drawer>
  );
}
