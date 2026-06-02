import { useState } from 'react';

interface CreateIssuePanelProps {
  onClose: () => void;
  onSubmit: () => void;
  title: string;
  setTitle: (t: string) => void;
  body: string;
  setBody: (b: string) => void;
  creating: boolean;
}

export default function CreateIssuePanel({
  onClose,
  onSubmit,
  title,
  setTitle,
  body,
  setBody,
  creating
}: CreateIssuePanelProps) {
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Judul issue tidak boleh kosong.');
      return;
    }
    setError('');
    onSubmit();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Header Panel */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 12px',
        flexShrink: 0,
        borderBottom: '1px solid var(--vscode-panel-border, var(--input-border))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--panel-fg)',
              cursor: 'pointer',
              padding: '2px 4px',
              display: 'flex',
              fontSize: '16px',
              lineHeight: 1,
              opacity: 0.7
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path fillRule="evenodd" d="M7.78 12.53a.75.75 0 01-1.06 0L2.47 8.28a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L4.81 7h7.44a.75.75 0 010 1.5H4.81l2.97 2.97a.75.75 0 010 1.06z" />
            </svg>
          </button>
          <h2 style={{ fontSize: '13px', fontWeight: 'bold' }}>Buat Issue Baru</h2>
        </div>
      </div>

      {/* Form Container */}
      <form onSubmit={handleSubmit} style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '12px',
        flex: 1,
        overflowY: 'auto'
      }}>
        {error && (
          <div style={{
            background: 'rgba(248, 81, 73, 0.1)',
            color: '#f85149',
            border: '1px solid rgba(248, 81, 73, 0.2)',
            borderRadius: '4px',
            padding: '8px',
            fontSize: '11px',
            fontWeight: 500
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* Input Judul */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--vscode-descriptionForeground)' }}>
            Judul Issue <span style={{ color: '#f85149' }}>*</span>
          </label>
          <input
            type="text"
            placeholder="Masukkan judul masalah..."
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (e.target.value.trim()) setError('');
            }}
            disabled={creating}
            style={{
              padding: '6px 8px',
              fontSize: '12px',
              background: 'var(--vscode-input-background)',
              color: 'var(--vscode-input-foreground)',
              border: '1px solid var(--input-border)',
              borderRadius: '2px',
              outline: 'none'
            }}
          />
        </div>

        {/* Input Deskripsi */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
          <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--vscode-descriptionForeground)' }}>
            Deskripsi (Mendukung Markdown)
          </label>
          <textarea
            placeholder="Berikan penjelasan detail mengenai isu ini..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={creating}
            rows={10}
            style={{
              padding: '8px',
              fontSize: '12px',
              background: 'var(--vscode-input-background)',
              color: 'var(--vscode-input-foreground)',
              border: '1px solid var(--input-border)',
              borderRadius: '2px',
              outline: 'none',
              resize: 'vertical',
              flex: 1,
              minHeight: '120px'
            }}
          />
        </div>

        {/* Tombol Aksi */}
        <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', paddingTop: '10px' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            style={{
              flex: 1,
              background: 'rgba(255, 255, 255, 0.04)',
              color: 'var(--panel-fg)',
              border: '1px solid var(--input-border)',
              padding: '8px',
              fontSize: '11px',
              fontWeight: 'bold',
              borderRadius: '2px',
              cursor: 'pointer',
              opacity: creating ? 0.6 : 1
            }}
          >
            Batal
          </button>
          
          <button
            type="submit"
            disabled={creating || !title.trim()}
            style={{
              flex: 2,
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              border: 'none',
              padding: '8px',
              fontSize: '11px',
              fontWeight: 'bold',
              borderRadius: '2px',
              cursor: 'pointer',
              opacity: (creating || !title.trim()) ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            {creating ? (
              <>
                <svg className="spin" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path fillRule="evenodd" d="M8 2.5a5.5 5.5 0 104.58 2.42l-1.11 1.11A4 4 0 118 4v2.5l3.5-3.5L8 0v2.5z" />
                </svg>
                Membuat...
              </>
            ) : (
              'Kirim Issue'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
