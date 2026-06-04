import { useState, useEffect, useMemo, useRef } from 'react';
import SettingsPanel from './components/SettingsPanel';
import CreateIssuePanel from './components/CreateIssuePanel';

// Tipe data issue sesuai backend
interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: { name: string; color: string }[];
  author?: string;
}

interface AIFileRecommendation {
  filePath: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
  lineRange?: { start: number; end: number };
  targetSymbol?: string;
}

// Inisialisasi API VS Code di Webview
let vscode: any = null;
try {
  // @ts-ignore
  vscode = acquireVsCodeApi();
} catch (e) {
  console.warn("VS Code API tidak terdeteksi, berjalan dalam mode standalone.");
}

// Parser Markdown Ringkas dan Ringan untuk React (Bebas Dependensi)
function parseInlineMarkdown(text: string) {
  const parts = [];
  const codeParts = text.split('`');
  
  for (let i = 0; i < codeParts.length; i++) {
    if (i % 2 === 1) {
      // Inline Code block
      parts.push(
        <code 
          key={`code-${i}`} 
          style={{ 
            background: 'var(--vscode-textCodeBlock-background, rgba(255,255,255,0.08))', 
            padding: '2px 4px', 
            borderRadius: '3px', 
            fontFamily: 'monospace', 
            fontSize: '11px',
            color: 'var(--vscode-textPreformat-foreground, #f28b50)'
          }}
        >
          {codeParts[i]}
        </code>
      );
    } else {
      // Regular text dengan pendeteksi Bold
      const boldParts = codeParts[i].split('**');
      for (let j = 0; j < boldParts.length; j++) {
        if (j % 2 === 1) {
          parts.push(<strong key={`bold-${i}-${j}`} style={{ fontWeight: 'bold' }}>{boldParts[j]}</strong>);
        } else {
          parts.push(boldParts[j]);
        }
      }
    }
  }
  return parts;
}

function renderMarkdown(text: string) {
  if (!text) return <p style={{ fontStyle: 'italic', opacity: 0.5 }}>Tidak ada deskripsi.</p>;
  
  const lines = text.split('\n');
  return lines.map((line, idx) => {
    const trimmed = line.trim();
    
    // Headers
    if (trimmed.startsWith('### ')) {
      return <h5 key={idx} style={{ margin: '10px 0 6px 0', fontSize: '12px', fontWeight: 'bold', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '2px' }}>{trimmed.slice(4)}</h5>;
    }
    if (trimmed.startsWith('## ')) {
      return <h4 key={idx} style={{ margin: '12px 0 8px 0', fontSize: '13px', fontWeight: 'bold' }}>{trimmed.slice(3)}</h4>;
    }
    if (trimmed.startsWith('# ')) {
      return <h3 key={idx} style={{ margin: '14px 0 10px 0', fontSize: '14px', fontWeight: 'bold' }}>{trimmed.slice(2)}</h3>;
    }
    
    // Bullet Lists
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      return (
        <li key={idx} style={{ marginLeft: '14px', listStyleType: 'disc', fontSize: '11.5px', marginBottom: '3px', lineHeight: '1.4' }}>
          {parseInlineMarkdown(trimmed.slice(2))}
        </li>
      );
    }

    // Empty Lines
    if (trimmed === '') {
      return <div key={idx} style={{ height: '6px' }} />;
    }

    // Paragraph
    return (
      <p key={idx} style={{ margin: '4px 0', fontSize: '11.5px', lineHeight: '1.4', wordBreak: 'break-word' }}>
        {parseInlineMarkdown(line)}
      </p>
    );
  });
}

function AISkeletonLoader() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', padding: '4px 0' }}>
      {/* Loading header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '4px' }}>
        <svg className="spin" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'var(--vscode-textLink-foreground)' }}>
          <path fillRule="evenodd" d="M8 2.5a5.5 5.5 0 104.58 2.42l-1.11 1.11A4 4 0 118 4v2.5l3.5-3.5L8 0v2.5z" />
        </svg>
        <span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', fontWeight: 500 }}>AI sedang menganalisis berkas terkait...</span>
      </div>

      {/* Ringkasan Analisis AI Skeleton */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div className="skeleton-pulse skeleton-title" style={{ width: '45%' }}></div>
        <div style={{ background: 'rgba(128,128,128,0.03)', padding: '8px', borderRadius: '4px', borderLeft: '2px solid var(--vscode-panel-border, rgba(128,128,128,0.2))' }}>
          <div className="skeleton-pulse skeleton-text"></div>
          <div className="skeleton-pulse skeleton-text-short"></div>
        </div>
      </div>

      {/* Rekomendasi Berkas Kode Skeleton */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
        <div className="skeleton-pulse skeleton-title" style={{ width: '60%' }}></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="skeleton-pulse" style={{ height: '10px', width: '65%' }}></div>
                <div className="skeleton-pulse skeleton-badge"></div>
              </div>
              <div className="skeleton-pulse" style={{ height: '8px', width: '85%', marginTop: '2px' }}></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [selectedLabel, setSelectedLabel] = useState('all');
  
  // State navigasi detail issue
  const [selectedIssue, setSelectedIssue] = useState<GitHubIssue | null>(null);
  
  // State analisis AI per-issue
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState('');
  const [aiFiles, setAiFiles] = useState<AIFileRecommendation[]>([]);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  
  // State form komentar
  const [commentText, setCommentText] = useState('');
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [submitSuccessMsg, setSubmitSuccessMsg] = useState('');
  const [togglingState, setTogglingState] = useState(false);
  
  // State navigasi halaman
  const [showSettings, setShowSettings] = useState(false);

  // State metadata
  const [repoDetected, setRepoDetected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [noIssues, setNoIssues] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [currentUser, setCurrentUser] = useState('Colorful');

  // Filter creator
  const [creatorFilter, setCreatorFilter] = useState<'all' | 'me' | 'others'>('all');

  // State Form Pembuatan Issue
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newIssueTitle, setNewIssueTitle] = useState('');
  const [newIssueBody, setNewIssueBody] = useState('');
  const [creatingIssue, setCreatingIssue] = useState(false);

  // Ref untuk scroll otomatis textarea ke bawah setelah Quick Suggest
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load awal & listener pesan IPC
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      if (vscode) {
        vscode.postMessage({ command: 'getIssues', isOffline: false });
      }
    };
    const handleOffline = () => {
      setIsOffline(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (vscode) {
      vscode.postMessage({ command: 'getInitialState' });
      vscode.postMessage({ command: 'getIssues', isOffline: !navigator.onLine });
    } else {
      // Jalankan simulasi data jika di luar VS Code (browser standalone)
      setTimeout(() => {
        const fallbackIssues: GitHubIssue[] = [
          {
            number: 101,
            title: "Bug: Login token expiration throws 401 unhandled exception",
            body: "When the user session expires, clicking refresh crashes the application with a 401 Unauthorized status code instead of redirecting to /login.",
            state: "open",
            author: "Colorful",
            labels: [
              { name: "bug", color: "d73a4a" },
              { name: "high-priority", color: "b60205" }
            ]
          },
          {
            number: 102,
            title: "Feature: Add Google OAuth option to authentication settings",
            body: "We need to allow users to sign in with Google OAuth directly from the settings panel.",
            state: "open",
            author: "johndoe",
            labels: [
              { name: "enhancement", color: "a2eeef" }
            ]
          },
          {
            number: 103,
            title: "Documentation: Update README with setup and deployment instructions",
            body: "The README file is currently empty. Please write complete steps to install dependencies, run the server, and deploy the VS Code extension.",
            state: "open",
            author: "Colorful",
            labels: [
              { name: "documentation", color: "0075ca" }
            ]
          }
        ];
        setIssues(fallbackIssues);
        setRepoDetected(true);
        setAuthenticated(false);
        setLoading(false);
      }, 500);
    }

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case 'issuesLoaded':
          setIssues(message.issues || []);
          if (message.currentUser) {
            setCurrentUser(message.currentUser);
          }
          setRepoDetected(!!message.repoDetected);
          setAuthenticated(!!message.authenticated);
          setLoading(false);
          setNoIssues(!message.fromCache && message.issues && message.issues.length === 0);
          if (message.isOffline !== undefined) {
            setIsOffline(message.isOffline);
          }
          break;
        case 'createIssueResult':
          setCreatingIssue(false);
          if (message.success) {
            setIssues(message.updatedIssues);
            setNewIssueTitle('');
            setNewIssueBody('');
            setShowCreateForm(false);
            setSubmitSuccessMsg('Issue baru berhasil dibuat!');
            setTimeout(() => setSubmitSuccessMsg(''), 3000);
          }
          break;
        case 'refreshTriggered':
          setNoIssues(false);
          handleRefresh();
          break;
        case 'initialState':
          if (message.filters) {
            setSearchText(message.filters.search || '');
            setSelectedLabel(message.filters.label || 'all');
          }
          break;
        case 'analysisResult':
          // Pastikan hasil AI yang masuk cocok dengan issue yang sedang aktif dibuka
          if (selectedIssue && selectedIssue.number === message.number) {
            setAiFiles(message.files || []);
            setAiSummary(message.summary || '');
            setAnalysisError(message.error || null);
            setAnalysisLoading(false);
          }
          break;
        case 'quickSuggestResult':
          if (selectedIssue && selectedIssue.number === message.number) {
            setCommentText(message.suggestion);
            setSuggestLoading(false);
            if (textareaRef.current) {
              textareaRef.current.focus();
            }
          }
          break;
        case 'postCommentResult':
          if (message.success) {
            setIssues(message.updatedIssues);
            // Update status issue yang sedang aktif dilihat tanpa menutup detail
            setSelectedIssue(prev => prev ? { ...prev, state: message.close ? 'closed' : 'open' } : null);
            setCommentText('');
            setSubmittingComment(false);
            setSubmitSuccessMsg(message.close ? 'Komentar dikirim & issue ditutup!' : 'Komentar berhasil dikirim!');
            setTimeout(() => setSubmitSuccessMsg(''), 3000);
          }
          break;
        case 'toggleIssueStateResult':
          setTogglingState(false);
          if (message.success) {
            setIssues(message.updatedIssues);
            setSelectedIssue(prev => prev ? { ...prev, state: message.state } : null);
            setSubmitSuccessMsg(message.state === 'closed' ? 'Issue ditutup!' : 'Issue dibuka kembali!');
            setTimeout(() => setSubmitSuccessMsg(''), 3000);
          }
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [selectedIssue]);

  // Simpan filter saat berubah
  useEffect(() => {
    if (vscode) {
      vscode.postMessage({
        command: 'saveFilters',
        filters: { search: searchText, label: selectedLabel }
      });
    }
  }, [searchText, selectedLabel]);

  // Handler klik buka issue detail
  const handleSelectIssue = (issue: GitHubIssue) => {
    setSelectedIssue(issue);
    setCommentText('');
    setAiSummary('');
    setAiFiles([]);
    setAnalysisError(null);
    setAnalysisLoading(true);
    
    // Picu analisis kode berbasis AI di Extension Host
    if (vscode) {
      vscode.postMessage({
        command: 'analyzeIssue',
        number: issue.number,
        title: issue.title,
        body: issue.body
      });
    } else {
      // Simulasi loading jika di luar VS Code
      setTimeout(() => {
        setAiSummary("Simulasi: Masalah terjadi pada pemanggilan token eksternal. Periksa berkas otentikasi.");
        setAiFiles([
          { filePath: "src/utils/auth.ts", confidence: "HIGH", reason: "Fungsi otentikasi token berada di berkas ini.", lineRange: { start: 45, end: 60 }, targetSymbol: "handleTokenRefresh" }
        ]);
        setAnalysisLoading(false);
      }, 1000);
    }
  };

  // Pemicu asisten draf balasan (Quick Suggest)
  const handleQuickSuggest = () => {
    if (!selectedIssue) return;
    setSuggestLoading(true);
    if (vscode) {
      vscode.postMessage({
        command: 'quickSuggest',
        number: selectedIssue.number,
        title: selectedIssue.title
      });
    } else {
      setTimeout(() => {
        setCommentText("Saya telah meninjau masalah ini dan sedang menyiapkan perbaikan di berkas terkait.");
        setSuggestLoading(false);
      }, 500);
    }
  };

  // Kirim balasan komentar
  const handlePostComment = (close: boolean) => {
    if (!selectedIssue || !commentText.trim()) return;
    setSubmittingComment(true);
    if (vscode) {
      vscode.postMessage({
        command: 'postComment',
        number: selectedIssue.number,
        comment: commentText,
        close: close
      });
    } else {
      // Simulasi respon sukses komentar
      setTimeout(() => {
        const updated = issues.map(i => {
          if (i.number === selectedIssue.number) {
            return { ...i, state: close ? 'closed' : 'open' };
          }
          return i;
        });
        setIssues(updated);
        setSelectedIssue(prev => prev ? { ...prev, state: close ? 'closed' : 'open' } : null);
        setCommentText('');
        setSubmittingComment(false);
        setSubmitSuccessMsg(close ? 'Komentar dikirim & issue ditutup!' : 'Komentar berhasil dikirim!');
        setTimeout(() => setSubmitSuccessMsg(''), 3000);
      }, 800);
    }
  };

  // Mengubah status issue secara instan tanpa menulis komentar
  const handleToggleIssueState = () => {
    if (!selectedIssue) return;
    const nextState = selectedIssue.state === 'open' ? 'closed' : 'open';
    setTogglingState(true);
    if (vscode) {
      vscode.postMessage({
        command: 'toggleIssueState',
        number: selectedIssue.number,
        state: nextState
      });
    } else {
      // Simulasi respon sukses di standalone browser
      setTimeout(() => {
        const updated = issues.map(i => {
          if (i.number === selectedIssue.number) {
            return { ...i, state: nextState };
          }
          return i;
        });
        setIssues(updated);
        setSelectedIssue(prev => prev ? { ...prev, state: nextState } : null);
        setTogglingState(false);
        setSubmitSuccessMsg(nextState === 'closed' ? 'Issue berhasil ditutup!' : 'Issue berhasil dibuka kembali!');
        setTimeout(() => setSubmitSuccessMsg(''), 3000);
      }, 800);
    }
  };

  // Membuat issue baru di GitHub
  const handleCreateIssue = () => {
    if (!newIssueTitle.trim()) return;
    setCreatingIssue(true);
    if (vscode) {
      vscode.postMessage({
        command: 'createIssue',
        title: newIssueTitle,
        body: newIssueBody
      });
    } else {
      // Simulasi pembuatan issue di standalone browser
      setTimeout(() => {
        const newIssueObj: GitHubIssue = {
          number: Math.floor(Math.random() * 1000) + 200,
          title: newIssueTitle,
          body: newIssueBody,
          state: 'open',
          author: currentUser,
          labels: []
        };
        const updated = [newIssueObj, ...issues];
        setIssues(updated);
        setNewIssueTitle('');
        setNewIssueBody('');
        setShowCreateForm(false);
        setCreatingIssue(false);
        setSubmitSuccessMsg('Issue baru berhasil dibuat!');
        setTimeout(() => setSubmitSuccessMsg(''), 3000);
      }, 800);
    }
  };

  // Handler refresh manual
  const handleRefresh = () => {
    setLoading(true);
    setSelectedIssue(null);
    setNoIssues(false);
    if (vscode) {
      vscode.postMessage({ command: 'refreshIssues', isOffline: !navigator.onLine });
    } else {
      setTimeout(() => setLoading(false), 800);
    }
  };

  // Buka berkas kode lokal
  const handleOpenFile = (file: AIFileRecommendation) => {
    if (vscode) {
      vscode.postMessage({ command: 'openFile', filePath: file.filePath, lineRange: file.lineRange || null });
    } else {
      alert(`Membuka berkas: ${file.filePath}${file.lineRange ? ` (baris ${file.lineRange.start}-${file.lineRange.end})` : ''}`);
    }
  };

  // Kumpulkan label unik
  const allLabels = useMemo(() => {
    const labelsSet = new Set<string>();
    const safeIssues = Array.isArray(issues) ? issues : [];
    safeIssues.forEach(issue => {
      if (issue && Array.isArray(issue.labels)) {
        issue.labels.forEach(label => {
          if (label && label.name) {
            labelsSet.add(label.name);
          }
        });
      }
    });
    return Array.from(labelsSet);
  }, [issues]);

  // Saring issue list
  const filteredIssues = useMemo(() => {
    const safeIssues = Array.isArray(issues) ? issues : [];
    return safeIssues.filter(issue => {
      if (!issue) return false;
      const matchesSearch = 
        (issue.title || '').toLowerCase().includes(searchText.toLowerCase()) ||
        (issue.body || '').toLowerCase().includes(searchText.toLowerCase()) ||
        (issue.number || '').toString().includes(searchText);
      
      const matchesLabel = 
        selectedLabel === 'all' || 
        (Array.isArray(issue.labels) && issue.labels.some(l => l && l.name === selectedLabel));
      
      let matchesCreator = true;
      if (creatorFilter === 'me') {
        matchesCreator = !!issue.author && issue.author.toLowerCase() === currentUser.toLowerCase();
      } else if (creatorFilter === 'others') {
        matchesCreator = !issue.author || issue.author.toLowerCase() !== currentUser.toLowerCase();
      }
      
      return matchesSearch && matchesLabel && matchesCreator;
    });
  }, [issues, searchText, selectedLabel, creatorFilter, currentUser]);

  // Render badge status
  const renderStatusBadge = (state: string) => {
    const isOpen = state.toLowerCase() === 'open';
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 6px',
        borderRadius: '10px',
        fontSize: '10px',
        fontWeight: 'bold',
        textTransform: 'uppercase',
        backgroundColor: isOpen ? 'rgba(46, 160, 67, 0.15)' : 'rgba(163, 113, 247, 0.15)',
        color: isOpen ? '#3fb950' : '#a371f7',
        border: `1px solid ${isOpen ? '#2ea043' : '#8b5cf6'}`
      }}>
        {isOpen ? 'Open' : 'Closed'}
      </span>
    );
  };

  // Render badge keyakinan file
  const renderConfidenceBadge = (confidence: string) => {
    let color = '#d29922'; // MED
    let bg = 'rgba(210, 153, 34, 0.15)';
    if (confidence === 'HIGH') {
      color = '#3fb950';
      bg = 'rgba(63, 185, 80, 0.15)';
    } else if (confidence === 'LOW') {
      color = '#f85149';
      bg = 'rgba(248, 81, 73, 0.15)';
    }
    return (
      <span style={{
        fontSize: '9px',
        fontWeight: 'bold',
        padding: '1px 4px',
        borderRadius: '3px',
        color,
        backgroundColor: bg,
        border: `1px solid ${color}45`
      }}>
        {confidence}
      </span>
    );
  };

  return showSettings ? (
    <SettingsPanel vscode={vscode} onClose={() => setShowSettings(false)} />
  ) : showCreateForm ? (
    <CreateIssuePanel
      onClose={() => setShowCreateForm(false)}
      onSubmit={handleCreateIssue}
      title={newIssueTitle}
      setTitle={setNewIssueTitle}
      body={newIssueBody}
      setBody={setNewIssueBody}
      creating={creatingIssue}
    />
  ) : (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', height: '100vh', gap: '12px', overflow: 'hidden' }}>
      
      {/* HEADER UTAMA */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--vscode-panel-border, var(--input-border))', paddingBottom: '8px', flexShrink: 0 }}>
        <h2 style={{ fontSize: '13px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm9 3a1 1 0 11-2 0 1 1 0 012 0zm-.25-6.25a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5z" />
          </svg>
          Issue Explorer
        </h2>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {!selectedIssue && (
            <button
              onClick={() => setShowCreateForm(true)}
              title="Buat Issue Baru"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--vscode-textLink-foreground, #007acc)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setShowSettings(true)}
            title="Settings"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--panel-fg)',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              opacity: 0.7
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path fillRule="evenodd" d="M3.5 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4.5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4.5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
            </svg>
          </button>
          <button 
            onClick={handleRefresh} 
            title="Refresh Issues"
            disabled={loading}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: 'var(--panel-fg)', 
              cursor: 'pointer', 
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              opacity: loading ? 0.5 : 1
            }}
          >
            <svg className={loading ? 'spin' : ''} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path fillRule="evenodd" d="M8 2.5a5.5 5.5 0 104.58 2.42l-1.11 1.11A4 4 0 118 4v2.5l3.5-3.5L8 0v2.5z" />
            </svg>
          </button>
        </div>
      </div>

      {isOffline && (
        <div style={{
          fontSize: '11px',
          color: '#c29000',
          background: 'rgba(255, 165, 0, 0.07)',
          border: '1px solid rgba(255, 165, 0, 0.25)',
          padding: '8px 10px',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px',
          flexShrink: 0,
          boxShadow: '0 2px 6px rgba(0,0,0,0.05)'
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, marginTop: '1px' }}>
            <path fillRule="evenodd" d="M8.22 1.754a.25.25 0 00-.44 0L1.698 13.132a.25.25 0 00.22.368h12.164a.25.25 0 00.22-.368L8.22 1.754zm-1.76 11.378L1.5 13.13l5.96-11.378h.08l5.96 11.378H6.46z" />
            <path d="M8 5c.552 0 1 .448 1 1v3c0 .552-.448 1-1 1s-1-.448-1-1V6c0-.552.448-1 1-1zm0 7a1 1 0 100-2 1 1 0 000 2z" />
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontWeight: 'bold' }}>Mode Offline Aktif</span>
            <span style={{ fontSize: '10px', opacity: 0.9 }}>Menampilkan data cached tanpa melakukan pemanggilan API GitHub.</span>
          </div>
        </div>
      )}

      {/* DETEKSI STATUS REPOSITORI */}
      {!loading && !selectedIssue && (
        <div style={{ 
          fontSize: '11.5px', 
          color: 'var(--vscode-sideBar-foreground)', 
          background: 'var(--vscode-welcomePage-tileBackground, rgba(255, 255, 255, 0.02))', 
          padding: '10px 12px', 
          borderRadius: '6px', 
          border: '1px solid var(--vscode-panel-border, var(--input-border))',
          display: 'flex', 
          flexDirection: 'column',
          gap: '8px',
          flexShrink: 0,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 500 }}>Status Repositori</span>
            <span style={{ 
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '10px',
              fontWeight: 'bold',
              backgroundColor: repoDetected ? 'rgba(0, 122, 255, 0.1)' : 'rgba(255, 165, 0, 0.1)',
              color: repoDetected ? '#007acc' : '#ffa500',
              border: `1px solid ${repoDetected ? 'rgba(0,122,255,0.2)' : 'rgba(255,165,0,0.2)'}`
            }}>
              {repoDetected ? 'Git Terdeteksi' : 'Mode Simulasi'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px', marginTop: '2px' }}>
            <span style={{ opacity: 0.8 }}>Koneksi GitHub</span>
            {authenticated ? (
              <span style={{ color: '#3fb950', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#3fb950', display: 'inline-block' }} />
                Terhubung
              </span>
            ) : (
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  console.log("Mengirim perintah loginGitHub...");
                  if (vscode) {
                    vscode.postMessage({ command: 'loginGitHub' });
                  } else {
                    alert('Simulasi login GitHub dipicu.');
                  }
                }}
                style={{ 
                  background: 'var(--vscode-button-background, #007acc)',
                  color: 'var(--vscode-button-foreground, #ffffff)',
                  border: 'none', 
                  borderRadius: '3px',
                  padding: '4px 10px',
                  fontSize: '10.5px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-button-hoverBackground, #0062a3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--vscode-button-background, #007acc)'}
              >
                Hubungkan Akun
              </button>
            )}
          </div>
        </div>
      )}


      {/* DETAIL ISSUE VIEW PANEL */}
      {selectedIssue ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, overflowY: 'auto', paddingRight: '2px' }}>
          
          {/* Tombol Back & Quick Action */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <button 
              onClick={() => setSelectedIssue(null)}
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                color: 'var(--panel-fg)',
                border: '1px solid var(--input-border)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                fontSize: '11px',
                borderRadius: '2px',
                cursor: 'pointer'
              }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M7.78 12.53a.75.75 0 01-1.06 0L2.47 8.28a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L4.81 7h7.44a.75.75 0 010 1.5H4.81l2.97 2.97a.75.75 0 010 1.06z" />
              </svg>
              Kembali
            </button>

            {/* Instant State Toggle Button */}
            <button
              onClick={handleToggleIssueState}
              disabled={togglingState || submittingComment}
              style={{
                background: selectedIssue.state.toLowerCase() === 'open' 
                  ? 'rgba(248, 81, 73, 0.12)' 
                  : 'rgba(46, 160, 67, 0.12)',
                color: selectedIssue.state.toLowerCase() === 'open' ? '#f85149' : '#3fb950',
                border: `1px solid ${selectedIssue.state.toLowerCase() === 'open' ? 'rgba(248, 81, 73, 0.25)' : 'rgba(46, 160, 67, 0.25)'}`,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                fontSize: '11px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontWeight: 600,
                opacity: (togglingState || submittingComment) ? 0.6 : 1,
                transition: 'all 0.15s ease-in-out'
              }}
              onMouseEnter={e => {
                if (!togglingState && !submittingComment) {
                  e.currentTarget.style.background = selectedIssue.state.toLowerCase() === 'open' 
                    ? 'rgba(248, 81, 73, 0.22)' 
                    : 'rgba(46, 160, 67, 0.22)';
                  e.currentTarget.style.borderColor = selectedIssue.state.toLowerCase() === 'open' 
                    ? 'rgba(248, 81, 73, 0.45)' 
                    : 'rgba(46, 160, 67, 0.45)';
                }
              }}
              onMouseLeave={e => {
                if (!togglingState && !submittingComment) {
                  e.currentTarget.style.background = selectedIssue.state.toLowerCase() === 'open' 
                    ? 'rgba(248, 81, 73, 0.12)' 
                    : 'rgba(46, 160, 67, 0.12)';
                  e.currentTarget.style.borderColor = selectedIssue.state.toLowerCase() === 'open' 
                    ? 'rgba(248, 81, 73, 0.25)' 
                    : 'rgba(46, 160, 67, 0.25)';
                }
              }}
            >
              {togglingState ? (
                <>
                  <svg className="spin" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: '2px' }}>
                    <path fillRule="evenodd" d="M8 2.5a5.5 5.5 0 104.58 2.42l-1.11 1.11A4 4 0 118 4v2.5l3.5-3.5L8 0v2.5z" />
                  </svg>
                  Proses...
                </>
              ) : selectedIssue.state.toLowerCase() === 'open' ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path fillRule="evenodd" d="M1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0zM0 8a8 8 0 1116 0A8 8 0 010 8zm9 3a1 1 0 11-2 0 1 1 0 012 0zm-.25-6.25a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5z" />
                  </svg>
                  Close Issue
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path fillRule="evenodd" d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm9 3a1 1 0 11-2 0 1 1 0 012 0zm-.25-6.25a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5z" />
                  </svg>
                  Reopen Issue
                </>
              )}
            </button>
          </div>

          {/* Judul & Nomor Issue */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 'bold', color: 'var(--vscode-textLink-foreground)', fontSize: '13px' }}>
                #{selectedIssue.number}
              </span>
              {renderStatusBadge(selectedIssue.state)}
            </div>
            <h3 style={{ fontSize: '13px', fontWeight: 'bold', lineHeight: '1.4' }}>{selectedIssue.title}</h3>
            
            {selectedIssue.labels.length > 0 && (
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '2px' }}>
                {selectedIssue.labels.map(label => (
                  <span key={label.name} style={{
                    fontSize: '9px',
                    padding: '0px 4px',
                    borderRadius: '2px',
                    backgroundColor: `#${label.color}15`,
                    color: `#${label.color}`,
                    border: `1px solid #${label.color}35`
                  }}>
                    {label.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* PANEL ANALISIS AI & FILE MAPPING */}
          <div style={{ 
            background: 'var(--vscode-welcomePage-tileBackground, rgba(0, 122, 255, 0.03))', 
            border: '1px solid var(--vscode-editorBracketHighlight-foreground1, rgba(0, 122, 255, 0.25))',
            padding: '10px', 
            borderRadius: '4px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            flexShrink: 0
          }}>
            <h4 style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--vscode-textLink-foreground)', display: 'flex', alignItems: 'center', gap: '5px', margin: 0 }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M9.5 0a.5.5 0 0 1 .5.5.75.75 0 0 0 1.5 0a.5.5 0 0 1 .5-.5h.75a.5.5 0 0 1 .5.5v.75a.5.5 0 0 1-.5.5a.75.75 0 0 0 0 1.5a.5.5 0 0 1 .5.5v.75a.5.5 0 0 1-.5.5H12a.5.5 0 0 1-.5-.5a.75.75 0 0 0-1.5 0a.5.5 0 0 1-.5.5H8.75a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5A.75.75 0 0 0 8.75 1a.5.5 0 0 1-.5-.5V.5A.5.5 0 0 1 8.75 0H9.5z" />
                <path fillRule="evenodd" d="M2.22 2.22a.75.75 0 0 1 1.06 0L4.5 3.44l1.22-1.22a.75.75 0 1 1 1.06 1.06L5.56 4.5l1.22 1.22a.75.75 0 1 1-1.06 1.06L4.5 5.56l-1.22 1.22a.75.75 0 0 1-1.06-1.06L3.44 4.5L2.22 3.28a.75.75 0 0 1 0-1.06z" />
                <path d="M1.75 8A1.75 1.75 0 0 0 0 9.75v4.5C0 15.216.784 16 1.75 16h12.5A1.75 1.75 0 0 0 16 14.25v-4.5A1.75 1.75 0 0 0 14.25 8H1.75zM1.5 9.75a.25.25 0 0 1 .25-.25h12.5a.25.25 0 0 1 .25.25v4.5a.25.25 0 0 1-.25.25H1.75a.25.25 0 0 1-.25-.25v-4.5z" />
              </svg>
              AI Code Mapping & Triage
            </h4>

            {/* Error Banner jika API Key bermasalah atau rate limit tercapai */}
            {analysisError && (
              <div style={{
                fontSize: '11px',
                color: 'var(--vscode-errorForeground, #f85149)',
                background: 'var(--vscode-inputValidation-errorBackground, rgba(248, 81, 73, 0.1))',
                border: '1px solid var(--vscode-inputValidation-errorBorder, rgba(248, 81, 73, 0.3))',
                padding: '8px 10px',
                borderRadius: '4px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                flexShrink: 0
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, marginTop: '1px' }}>
                    <path fillRule="evenodd" d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm9 3a1 1 0 11-2 0 1 1 0 012 0zm-.25-6.25a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5z" />
                  </svg>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontWeight: 'bold' }}>
                      {analysisError.toLowerCase().includes('401') || 
                       analysisError.toLowerCase().includes('api key') || 
                       analysisError.toLowerCase().includes('unauthorized') ||
                       analysisError.toLowerCase().includes('tidak valid')
                        ? 'Kunci API Tidak Valid'
                        : analysisError.toLowerCase().includes('429') || 
                          analysisError.toLowerCase().includes('rate limit') || 
                          analysisError.toLowerCase().includes('quota') ||
                          analysisError.toLowerCase().includes('habis')
                          ? 'Batas Kuota Tercapai (Rate Limit)'
                          : 'Kegagalan Analisis AI'}
                    </span>
                    <span style={{ fontSize: '10px', opacity: 0.95, lineHeight: '1.3' }}>
                      {analysisError.toLowerCase().includes('401') || 
                       analysisError.toLowerCase().includes('api key') || 
                       analysisError.toLowerCase().includes('unauthorized') ||
                       analysisError.toLowerCase().includes('tidak valid')
                        ? 'Kunci API yang dikonfigurasi tidak valid atau belum diset. Harap periksa setelan Anda.'
                        : analysisError.toLowerCase().includes('429') || 
                          analysisError.toLowerCase().includes('rate limit') || 
                          analysisError.toLowerCase().includes('quota') ||
                          analysisError.toLowerCase().includes('habis')
                          ? 'Batas penggunaan API tercapai atau token habis. Anda dapat menunggu beberapa saat atau memperbarui kunci API.'
                          : `Detail: ${analysisError}`}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setShowSettings(true)}
                  style={{
                    background: 'var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2))',
                    color: 'var(--vscode-button-secondaryForeground, var(--panel-fg))',
                    border: '1px solid var(--vscode-button-secondaryBorder, transparent)',
                    borderRadius: '3px',
                    padding: '3px 8px',
                    fontSize: '10px',
                    cursor: 'pointer',
                    alignSelf: 'flex-start',
                    fontWeight: 500,
                    marginTop: '2px',
                    transition: 'background 0.2s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.3))'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2))'}
                >
                  ⚙️ Buka Pengaturan API Key
                </button>
              </div>
            )}

            {analysisLoading ? (
              <AISkeletonLoader />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                
                {/* Ringkasan Masalah AI */}
                {aiSummary && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--vscode-descriptionForeground)' }}>Ringkasan Analisis AI:</span>
                    <p style={{ fontSize: '11px', lineHeight: '1.4', background: 'rgba(0,0,0,0.08)', padding: '6px', borderRadius: '3px', borderLeft: '2px solid var(--vscode-textLink-foreground)' }}>
                      {aiSummary}
                    </p>
                  </div>
                )}

                {/* Rekomendasi File Klik */}
                {aiFiles.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--vscode-descriptionForeground)' }}>Rekomendasi Berkas Kode (Top 3):</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {aiFiles.map((file, i) => (
                        <div 
                          key={i} 
                          onClick={() => handleOpenFile(file)}
                          style={{
                            padding: '6px 8px',
                            background: 'var(--vscode-input-background, rgba(255,255,255,0.02))',
                            border: '1px solid var(--input-border)',
                            borderRadius: '3px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            transition: 'border-color 0.2s, background 0.2s'
                          }}
                          className="file-recommendation"
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>📄 {file.filePath}</span>
                            {renderConfidenceBadge(file.confidence)}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            {file.lineRange && (
                              <span style={{
                                fontSize: '9px',
                                fontWeight: 'bold',
                                padding: '1px 5px',
                                borderRadius: '3px',
                                color: '#58a6ff',
                                backgroundColor: 'rgba(88, 166, 255, 0.12)',
                                border: '1px solid rgba(88, 166, 255, 0.3)',
                                fontFamily: 'monospace',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px'
                              }}>
                                <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
                                  <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6.621a1.5 1.5 0 0 0-.44-1.06L9.439 2.44A1.5 1.5 0 0 0 8.378 2H4.5zM6.5 8.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1H7a.5.5 0 0 1-.5-.5zM7 11a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1A.5.5 0 0 1 7 11z"/>
                                </svg>
                                L{file.lineRange.start}-{file.lineRange.end}
                              </span>
                            )}
                            {file.targetSymbol && (
                              <span style={{
                                fontSize: '9px',
                                fontWeight: 500,
                                padding: '1px 5px',
                                borderRadius: '3px',
                                color: '#d2a8ff',
                                backgroundColor: 'rgba(210, 168, 255, 0.1)',
                                border: '1px solid rgba(210, 168, 255, 0.25)',
                                fontFamily: 'monospace'
                              }}>
                                {file.targetSymbol}
                              </span>
                            )}
                          </div>
                          {file.reason && (
                            <span style={{ fontSize: '9.5px', color: 'var(--vscode-descriptionForeground)', lineHeight: '1.3' }}>
                              {file.reason}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <span style={{ fontSize: '9px', color: 'var(--vscode-descriptionForeground)', fontStyle: 'italic', textAlign: 'center', marginTop: '2px' }}>
                  *Klik berkas di atas untuk membuka kodenya langsung di editor. Baris target akan disorot otomatis.
                </span>
              </div>
            )}
          </div>

          {/* DESKRIPSI LENGKAP ISSUE (MARKDOWN) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
            <label style={{ fontSize: '10.5px', fontWeight: 'bold', color: 'var(--vscode-descriptionForeground)' }}>Deskripsi Masalah (GitHub)</label>
            <div style={{ 
              background: 'rgba(255, 255, 255, 0.01)', 
              border: '1px solid var(--input-border)', 
              padding: '10px', 
              borderRadius: '4px',
              maxHeight: '180px',
              overflowY: 'auto'
            }}>
              {renderMarkdown(selectedIssue.body)}
            </div>
          </div>

          {/* FORM BALASAN & AKSI (INLINE REPLY) */}
          <div style={{ 
            borderTop: '1px solid var(--vscode-panel-border, var(--input-border))', 
            paddingTop: '12px', 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '8px',
            flexShrink: 0,
            marginTop: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--vscode-descriptionForeground)' }}>Tulis Balasan Cepat</label>
              
              <button
                onClick={handleQuickSuggest}
                disabled={suggestLoading || submittingComment}
                style={{
                  background: 'var(--vscode-textLink-foreground, #007acc)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '2px',
                  padding: '2px 8px',
                  fontSize: '10.5px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: 'pointer',
                  opacity: (suggestLoading || submittingComment) ? 0.6 : 1
                }}
              >
                {suggestLoading ? (
                  <svg className="spin" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                    <path fillRule="evenodd" d="M8 2.5a5.5 5.5 0 104.58 2.42l-1.11 1.11A4 4 0 118 4v2.5l3.5-3.5L8 0v2.5z" />
                  </svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                    <path fillRule="evenodd" d="M11.5 7.5a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z" />
                    <path fillRule="evenodd" d="M11.865 11.235a5 5 0 111.06-1.06l3.355 3.355a.75.75 0 11-1.06 1.06l-3.355-3.355zM11 7.5a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z" />
                  </svg>
                )}
                Quick Suggest (AI)
              </button>
            </div>

            <textarea 
              ref={textareaRef}
              rows={4}
              placeholder="Tulis balasan draf Markdown di sini..."
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              disabled={submittingComment}
              style={{
                width: '100%',
                resize: 'vertical',
                fontSize: '11.5px',
                padding: '6px',
                background: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--input-border)'
              }}
            />

            {submitSuccessMsg && (
              <div style={{ color: '#3fb950', fontSize: '11px', fontWeight: 'bold', textAlign: 'center' }}>
                ✓ {submitSuccessMsg}
              </div>
            )}

            {/* Tombol Kirim */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => handlePostComment(false)}
                disabled={submittingComment || !commentText.trim()}
                style={{
                  flex: 1,
                  background: 'var(--vscode-button-background)',
                  color: 'var(--vscode-button-foreground)',
                  padding: '6px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  opacity: (submittingComment || !commentText.trim()) ? 0.6 : 1
                }}
              >
                Comment
              </button>
              <button
                onClick={() => handlePostComment(true)}
                disabled={submittingComment || !commentText.trim()}
                style={{
                  flex: 1,
                  background: 'var(--vscode-button-secondaryBackground, rgba(255,255,255,0.08))',
                  color: 'var(--vscode-button-secondaryForeground, var(--panel-fg))',
                  border: '1px solid var(--input-border)',
                  padding: '6px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  opacity: (submittingComment || !commentText.trim()) ? 0.6 : 1
                }}
              >
                Comment & Close
              </button>
            </div>
          </div>

        </div>
      ) : (
        /* LIST EXPLORER VIEW */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1, overflow: 'hidden' }}>
          
          {/* INPUT & FILTER PANEL */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input 
                type="text" 
                placeholder="Cari issue berdasarkan judul/nomor..." 
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                style={{ width: '100%', paddingLeft: '24px', fontSize: '11.5px' }}
              />
              <svg style={{ position: 'absolute', left: '8px', color: 'var(--vscode-descriptionForeground)' }} width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M11.5 7a4.499 4.499 0 11-8.998 0A4.499 4.499 0 0111.5 7zm-.82 4.74a6 6 0 111.06-1.06l3.04 3.04a.75.75 0 11-1.06 1.06l-3.04-3.04z" />
              </svg>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>Saring Berdasarkan Label</label>
              <select 
                value={selectedLabel} 
                onChange={e => setSelectedLabel(e.target.value)}
                style={{ width: '100%', cursor: 'pointer', fontSize: '11.5px' }}
              >
                <option value="all">Semua Label</option>
                {allLabels.map(label => (
                  <option key={label} value={label}>{label}</option>
                ))}
              </select>
            </div>

            {/* Saring Berdasarkan Pembuat */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>Pembuat Issue</label>
              <div style={{ 
                display: 'flex', 
                background: 'rgba(255, 255, 255, 0.02)', 
                padding: '2px', 
                borderRadius: '4px', 
                border: '1px solid var(--input-border)' 
              }}>
                <button 
                  type="button"
                  onClick={() => setCreatorFilter('all')}
                  style={{
                    flex: 1,
                    background: creatorFilter === 'all' ? 'var(--vscode-button-background, #007acc)' : 'transparent',
                    color: creatorFilter === 'all' ? 'var(--vscode-button-foreground, #fff)' : 'var(--vscode-descriptionForeground)',
                    border: 'none',
                    borderRadius: '3px',
                    padding: '4px 0',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    transition: 'background 0.15s, color 0.15s'
                  }}
                >
                  Semua
                </button>
                <button 
                  type="button"
                  onClick={() => setCreatorFilter('me')}
                  style={{
                    flex: 1,
                    background: creatorFilter === 'me' ? 'var(--vscode-button-background, #007acc)' : 'transparent',
                    color: creatorFilter === 'me' ? 'var(--vscode-button-foreground, #fff)' : 'var(--vscode-descriptionForeground)',
                    border: 'none',
                    borderRadius: '3px',
                    padding: '4px 0',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    transition: 'background 0.15s, color 0.15s'
                  }}
                >
                  Milik Saya
                </button>
                <button 
                  type="button"
                  onClick={() => setCreatorFilter('others')}
                  style={{
                    flex: 1,
                    background: creatorFilter === 'others' ? 'var(--vscode-button-background, #007acc)' : 'transparent',
                    color: creatorFilter === 'others' ? 'var(--vscode-button-foreground, #fff)' : 'var(--vscode-descriptionForeground)',
                    border: 'none',
                    borderRadius: '3px',
                    padding: '4px 0',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    transition: 'background 0.15s, color 0.15s'
                  }}
                >
                  Orang Lain
                </button>
              </div>
            </div>
          </div>

          {/* LOADING DAFTAR */}
          {loading ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
              <svg className="spin" width="24" height="24" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'var(--vscode-textLink-foreground)' }}>
                <path fillRule="evenodd" d="M8 2.5a5.5 5.5 0 104.58 2.42l-1.11 1.11A4 4 0 118 4v2.5l3.5-3.5L8 0v2.5z" />
              </svg>
              <span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)' }}>Menyelaraskan daftar issue...</span>
            </div>
          ) : (
            /* LIST SCROLLABLE VIEW */
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '8px', 
              overflowY: 'auto', 
              flex: 1,
              paddingRight: '2px'
            }}>
              {filteredIssues.length === 0 ? (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  textAlign: 'center', color: 'var(--vscode-descriptionForeground)',
                  padding: '32px 16px', gap: '12px',
                  border: '1px dashed var(--input-border)',
                  borderRadius: '6px', fontSize: '12px',
                  flex: 1, marginTop: '8px'
                }}>
                  {noIssues && issues.length === 0 && !searchText && selectedLabel === 'all' ? (
                    <>
                      <svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.3 }}>
                        <path fillRule="evenodd" d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm9 3a1 1 0 11-2 0 1 1 0 012 0zm-.25-6.25a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5z" />
                      </svg>
                      <span style={{ fontWeight: 'bold', fontSize: '13px' }}>Tidak Ada Isu Terbuka</span>
                      <span style={{ fontSize: '11px', opacity: 0.7, lineHeight: 1.4 }}>
                        Repositori ini tidak memiliki isu yang aktif.
                        <br />Buat isu baru di GitHub untuk memulai.
                      </span>
                    </>
                  ) : noIssues ? (
                    <>
                      <svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.3 }}>
                        <path fillRule="evenodd" d="M2.5 8a5.5 5.5 0 1111 0 5.5 5.5 0 01-11 0zM8 1a7 7 0 100 14A7 7 0 008 1zm3.36 3.36a.75.75 0 010 1.06l-2.25 2.25a.75.75 0 01-1.06 0L5.8 5.36a.75.75 0 111.06-1.06l.89.89V1.75a.75.75 0 011.5 0v3.44l.89-.89a.75.75 0 011.06 0z"/>
                      </svg>
                      <span style={{ fontWeight: 'bold', fontSize: '13px' }}>Isu Tidak Ditemukan</span>
                      <span style={{ fontSize: '11px', opacity: 0.7, lineHeight: 1.4 }}>
                        Tidak ada isu yang berhasil dimuat dari repositori ini.
                        <br />Coba refresh atau periksa koneksi GitHub Anda.
                      </span>
                    </>
                  ) : (
                    <>
                      <svg width="28" height="28" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.25 }}>
                        <path fillRule="evenodd" d="M11.5 7a4.499 4.499 0 11-8.998 0A4.499 4.499 0 0111.5 7zm-.82 4.74a6 6 0 111.06-1.06l3.04 3.04a.75.75 0 11-1.06 1.06l-3.04-3.04z" />
                      </svg>
                      <span style={{ fontWeight: 'bold', fontSize: '13px' }}>Tidak Ada Hasil</span>
                      <span style={{ fontSize: '11px', opacity: 0.7, lineHeight: 1.4 }}>
                        Tidak ada isu yang cocok dengan filter atau pencarian saat ini.
                      </span>
                    </>
                  )}
                </div>
              ) : (
                filteredIssues.map(issue => (
                  <div 
                    key={issue.number} 
                    onClick={() => handleSelectIssue(issue)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid var(--input-border)',
                      borderRadius: '4px',
                      padding: '8px 10px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      transition: 'background 0.2s, border-color 0.2s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                      e.currentTarget.style.borderColor = 'var(--focus-border)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                      e.currentTarget.style.borderColor = 'var(--input-border)';
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--vscode-textLink-foreground)' }}>
                        #{issue.number}
                      </span>
                      {renderStatusBadge(issue.state)}
                    </div>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', lineHeight: '1.3' }}>
                      {issue.title}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px', gap: '4px', flexWrap: 'wrap' }}>
                      {issue.labels.length > 0 ? (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {issue.labels.map(label => (
                            <span 
                              key={label.name} 
                              style={{
                                fontSize: '9px',
                                padding: '0 4px',
                                borderRadius: '2px',
                                fontWeight: 500,
                                backgroundColor: `#${label.color}20`,
                                color: `#${label.color}`,
                                border: `1px solid #${label.color}35`
                              }}
                            >
                              {label.name}
                            </span>
                          ))}
                        </div>
                      ) : <div />}
                      {issue.author && (
                        <span style={{ fontSize: '9.5px', color: 'var(--vscode-descriptionForeground)', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                          👤 @{issue.author}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* CSS Animasi Tambahan */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 1s linear infinite;
        }
        .file-recommendation:hover {
          background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.06)) !important;
          border-color: var(--vscode-focusBorder, var(--focus-border)) !important;
        }
      `}</style>
    </div>
  );
}
