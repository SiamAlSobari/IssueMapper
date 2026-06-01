import { useState, useEffect } from 'react';

type AIProvider = 'openai' | 'gemini' | 'groq' | 'ollama';

interface SettingsPanelProps {
  vscode: any;
  onClose: () => void;
}

type SectionId = 'provider' | 'openai' | 'gemini' | 'groq' | 'ollama';

export default function SettingsPanel({ vscode, onClose }: SettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<SectionId | null>(null);
  const [provider, setProvider] = useState<AIProvider>('openai');
  const [openaiKey, setOpenaiKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Ambil pengaturan yang terdaftar saat modul dipasang
  useEffect(() => {
    if (vscode) {
      vscode.postMessage({ command: 'getSettings' });
    }

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'settingsLoaded') {
        if (message.activeProvider) setProvider(message.activeProvider);
        if (message.selectedModel) setModel(message.selectedModel);
        if (message.ollamaHostUrl) setOllamaUrl(message.ollamaHostUrl);
        
        // Tampilkan placeholder jika key sudah terisi di OS keychain
        if (message.hasOpenaiKey) setOpenaiKey('••••••••');
        if (message.hasGeminiKey) setGeminiKey('••••••••');
        if (message.hasGroqKey) setGroqKey('••••••••');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    if (vscode) {
      vscode.postMessage({
        command: 'saveSettings',
        provider,
        openaiKey,
        geminiKey,
        groqKey,
        model,
        ollamaUrl,
      });
    }
    setTimeout(() => {
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }, 300);
  };

  const providerModels: Record<AIProvider, string> = {
    openai: 'gpt-4o-mini',
    gemini: 'gemini-3-flash',
    groq: 'deepseek-r1-distill-llama-70b',
    ollama: 'llama3',
  };

  const providerIcon: Record<AIProvider, string> = {
    openai: '◈',
    gemini: '◇',
    groq: '◆',
    ollama: '○',
  };

  const handleProviderChange = (p: AIProvider) => {
    setProvider(p);
    setModel(providerModels[p]);
  };

  const providerOptions = [
    { value: 'openai' as AIProvider, label: 'OpenAI', desc: 'GPT-4o, GPT-4o-mini' },
    { value: 'gemini' as AIProvider, label: 'Google Gemini', desc: 'Gemini 3 Flash, Gemini 2.5 Flash' },
    { value: 'groq' as AIProvider, label: 'Groq', desc: 'DeepSeek R1, Llama 4 Scout, Mixtral' },
    { value: 'ollama' as AIProvider, label: 'Ollama (Lokal)', desc: 'Jalankan model AI di mesin lokal' },
  ];

  const toggleSection = (id: SectionId) => {
    setActiveSection(activeSection === id ? null : id);
  };

  const sectionHeader = (id: SectionId, label: string, icon: string, isActive: boolean) => (
    <div
      onClick={() => toggleSection(id)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 10px', cursor: 'pointer', borderRadius: '4px',
        background: isActive ? 'var(--vscode-list-hoverBackground, rgba(255,255,255,0.05))' : 'transparent',
        border: '1px solid var(--input-border)',
        fontSize: '11.5px', fontWeight: 'bold',
        transition: 'background 0.15s',
        userSelect: 'none',
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ opacity: 0.6 }}>{icon}</span>
        {label}
      </span>
      <svg
        width="12" height="12" viewBox="0 0 16 16" fill="currentColor"
        style={{ transform: isActive ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
      >
        <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06z" />
      </svg>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 12px', flexShrink: 0,
        borderBottom: '1px solid var(--vscode-panel-border, var(--input-border))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: 'var(--panel-fg)', cursor: 'pointer',
              padding: '2px 4px', display: 'flex', fontSize: '16px', lineHeight: 1, opacity: 0.7
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path fillRule="evenodd" d="M7.78 12.53a.75.75 0 01-1.06 0L2.47 8.28a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L4.81 7h7.44a.75.75 0 010 1.5H4.81l2.97 2.97a.75.75 0 010 1.06z" />
            </svg>
          </button>
          <h2 style={{ fontSize: '13px', fontWeight: 'bold' }}>Settings</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {saved && (
            <span style={{ color: '#3fb950', fontSize: '10.5px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
              </svg>
              Tersimpan
            </span>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>

          {/* PROVIDER SECTION */}
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--vscode-descriptionForeground)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>AI Provider</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {providerOptions.map(opt => {
                const isSelected = provider === opt.value;
                return (
                  <div
                    key={opt.value}
                    onClick={() => handleProviderChange(opt.value)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '10px 12px', cursor: 'pointer', borderRadius: '6px',
                      border: `1px solid ${isSelected ? 'var(--vscode-focusBorder)' : 'var(--input-border)'}`,
                      background: isSelected ? 'var(--vscode-list-activeSelectionBackground, rgba(0,122,204,0.08))' : 'transparent',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      if (!isSelected) e.currentTarget.style.borderColor = 'var(--vscode-focusBorder)';
                    }}
                    onMouseLeave={e => {
                      if (!isSelected) e.currentTarget.style.borderColor = 'var(--input-border)';
                    }}
                  >
                    <div style={{
                      width: '22px', height: '22px', borderRadius: '50%', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', fontSize: '11px',
                      fontWeight: 'bold', flexShrink: 0,
                      background: isSelected ? 'var(--vscode-button-background)' : 'rgba(255,255,255,0.06)',
                      color: isSelected ? 'var(--vscode-button-foreground)' : 'var(--panel-fg)',
                    }}>
                      {providerIcon[opt.value]}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                      <span style={{ fontSize: '12px', fontWeight: isSelected ? 'bold' : 500 }}>{opt.label}</span>
                      <span style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)', opacity: 0.7 }}>{opt.desc}</span>
                    </div>
                    {isSelected && (
                      <svg style={{ marginLeft: 'auto' }} width="14" height="14" viewBox="0 0 16 16" fill="var(--vscode-button-background)">
                        <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                      </svg>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* MODEL INPUT */}
          <div style={{
            background: 'rgba(255,255,255,0.02)', border: '1px solid var(--input-border)',
            borderRadius: '6px', padding: '10px 12px',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--vscode-descriptionForeground)' }}>
                Model
                {provider !== 'ollama' && (
                  <span style={{ fontWeight: 400, opacity: 0.6 }}> (default: {providerModels[provider]})</span>
                )}
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  placeholder={provider === 'ollama' ? 'llama3, codellama, mistral...' : providerModels[provider]}
                  style={{ width: '100%', fontSize: '11.5px', padding: '5px 8px' }}
                />
              </div>
              <span style={{ fontSize: '9.5px', color: 'var(--vscode-descriptionForeground)', opacity: 0.6, lineHeight: 1.3 }}>
                {provider === 'ollama'
                  ? 'Nama model Ollama yang tersedia di mesin lokal Anda.'
                  : 'Kosongkan untuk menggunakan model default provider.'}
              </span>
            </div>
          </div>

          {/* API KEYS SECTION - TIDAK UNTUK OLLAMA */}
          {provider !== 'ollama' && (
            <div style={{ marginTop: '4px' }}>
              <div style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--vscode-descriptionForeground)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>API Keys</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>

                {/* OPENAI */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {sectionHeader('openai', 'OpenAI API Key', '◈', activeSection === 'openai')}
                  {activeSection === 'openai' && (
                    <div style={{ padding: '8px 4px 4px' }}>
                      <input
                        type="password"
                        placeholder="sk-..."
                        value={openaiKey}
                        onChange={e => setOpenaiKey(e.target.value)}
                        style={{ width: '100%', fontSize: '11.5px', padding: '5px 8px' }}
                      />
                      <span style={{ fontSize: '9.5px', color: 'var(--vscode-descriptionForeground)', opacity: 0.6, marginTop: '3px', display: 'block' }}>
                        https://platform.openai.com/api-keys
                      </span>
                    </div>
                  )}
                </div>

                {/* GEMINI */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {sectionHeader('gemini', 'Google Gemini API Key', '◇', activeSection === 'gemini')}
                  {activeSection === 'gemini' && (
                    <div style={{ padding: '8px 4px 4px' }}>
                      <input
                        type="password"
                        placeholder="AIza..."
                        value={geminiKey}
                        onChange={e => setGeminiKey(e.target.value)}
                        style={{ width: '100%', fontSize: '11.5px', padding: '5px 8px' }}
                      />
                      <span style={{ fontSize: '9.5px', color: 'var(--vscode-descriptionForeground)', opacity: 0.6, marginTop: '3px', display: 'block' }}>
                        https://aistudio.google.com/apikey
                      </span>
                    </div>
                  )}
                </div>

                {/* GROQ */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {sectionHeader('groq', 'Groq API Key', '◆', activeSection === 'groq')}
                  {activeSection === 'groq' && (
                    <div style={{ padding: '8px 4px 4px' }}>
                      <input
                        type="password"
                        placeholder="gsk_..."
                        value={groqKey}
                        onChange={e => setGroqKey(e.target.value)}
                        style={{ width: '100%', fontSize: '11.5px', padding: '5px 8px' }}
                      />
                      <span style={{ fontSize: '9.5px', color: 'var(--vscode-descriptionForeground)', opacity: 0.6, marginTop: '3px', display: 'block' }}>
                        https://console.groq.com/keys
                      </span>
                    </div>
                  )}
                </div>

              </div>
            </div>
          )}

          {/* OLLAMA HOST URL */}
          {provider === 'ollama' && (
            <div style={{ marginTop: '4px' }}>
              <div style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--vscode-descriptionForeground)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>Koneksi Lokal</div>
              <div style={{
                background: 'rgba(255,255,255,0.02)', border: '1px solid var(--input-border)',
                borderRadius: '6px', padding: '10px 12px',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--vscode-descriptionForeground)' }}>Ollama Host URL</label>
                  <input
                    type="text"
                    value={ollamaUrl}
                    onChange={e => setOllamaUrl(e.target.value)}
                    style={{ width: '100%', fontSize: '11.5px', fontFamily: 'monospace', padding: '5px 8px' }}
                  />
                  <span style={{ fontSize: '9.5px', color: 'var(--vscode-descriptionForeground)', opacity: 0.6, lineHeight: 1.3 }}>
                    Default: <code>http://localhost:11434</code>. Ubah jika Ollama berjalan di host lain.
                  </span>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* SAVE BUTTON BAR */}
      <div style={{
        borderTop: '1px solid var(--vscode-panel-border, var(--input-border))',
        padding: '10px 12px', display: 'flex', gap: '8px', flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          style={{
            flex: 1, padding: '7px', fontSize: '11.5px', fontWeight: 500, cursor: 'pointer',
            background: 'var(--vscode-button-secondaryBackground, rgba(255,255,255,0.06))',
            color: 'var(--vscode-button-secondaryForeground, var(--panel-fg))',
            border: '1px solid var(--input-border)',
            borderRadius: '3px',
          }}
        >
          Batal
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            flex: 2, padding: '7px', fontSize: '11.5px', fontWeight: 'bold', cursor: 'pointer',
            opacity: saving ? 0.6 : 1,
            borderRadius: '3px',
          }}
        >
          {saving ? (
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <svg className="spin" width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M8 2.5a5.5 5.5 0 104.58 2.42l-1.11 1.11A4 4 0 118 4v2.5l3.5-3.5L8 0v2.5z" />
              </svg>
              Menyimpan...
            </span>
          ) : 'Save Settings'}
        </button>
      </div>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
