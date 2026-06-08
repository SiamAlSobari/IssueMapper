import { useMemo } from 'react';

export interface DiffBlock {
  filePath: string;
  oldCode: string;
  newCode: string;
  summary: string;
  startLine: number;
  endLine: number;
}

interface DiffViewProps {
  diff: DiffBlock;
  onApply: () => void;
  onDismiss: () => void;
  applying?: boolean;
}

function computeLineDiff(oldLines: string[], newLines: string[]) {
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const changes: { type: 'same' | 'remove' | 'add'; line: string; oldLineNum?: number; newLineNum?: number }[] = [];
  let i = m, j = n;
  const reversed: typeof changes = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      reversed.push({ type: 'same', line: oldLines[i - 1], oldLineNum: i, newLineNum: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      reversed.push({ type: 'add', line: newLines[j - 1], newLineNum: j });
      j--;
    } else {
      reversed.push({ type: 'remove', line: oldLines[i - 1], oldLineNum: i });
      i--;
    }
  }

  for (let k = reversed.length - 1; k >= 0; k--) {
    changes.push(reversed[k]);
  }

  return changes;
}

const lineStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    fontSize: '11px',
    lineHeight: '1.5',
    overflowX: 'auto',
  },
  line: {
    display: 'flex',
    alignItems: 'center',
    padding: '1px 4px',
    minHeight: '18px',
    borderRadius: '1px',
  },
  lineNum: {
    display: 'inline-block',
    minWidth: '32px',
    textAlign: 'right',
    paddingRight: '8px',
    color: 'var(--vscode-editorLineNumber-foreground, rgba(128,128,128,0.5))',
    userSelect: 'none',
    fontSize: '10px',
    flexShrink: 0,
  },
  addLineNum: {
    color: 'var(--vscode-diffEditor-foreground, #3fb950)',
  },
  removeLineNum: {
    color: 'var(--vscode-diffEditor-foreground, #f85149)',
  },
  add: {
    background: 'var(--vscode-diffEditor-insertedLineBackground, rgba(63, 185, 80, 0.15))',
    borderLeft: '3px solid var(--vscode-diffEditor-insertedLineBorder, #3fb950)',
  },
  remove: {
    background: 'var(--vscode-diffEditor-removedLineBackground, rgba(248, 81, 73, 0.13))',
    borderLeft: '3px solid var(--vscode-diffEditor-removedLineBorder, #f85149)',
  },
  same: {
    borderLeft: '3px solid transparent',
  },
  gutter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    flexShrink: 0,
    fontSize: '10px',
    color: 'var(--vscode-editorLineNumber-foreground, rgba(128,128,128,0.4))',
  },
};

function DiffLine({
  change,
  index,
}: {
  change: { type: 'same' | 'remove' | 'add'; line: string; oldLineNum?: number; newLineNum?: number };
  index: number;
}) {
  const typeStyle = lineStyles[change.type];
  const lineNumStyle = {
    ...lineStyles.lineNum,
    ...(change.type === 'add' ? lineStyles.addLineNum : {}),
    ...(change.type === 'remove' ? lineStyles.removeLineNum : {}),
  };

  const gutterIcon = change.type === 'add' ? '+' : change.type === 'remove' ? '-' : ' ';

  return (
    <div
      key={index}
      style={{
        ...lineStyles.line,
        ...typeStyle,
      }}
    >
      <span style={lineStyles.gutter}>{gutterIcon}</span>
      <span style={lineNumStyle}>
        {change.type === 'add' ? '' : change.oldLineNum}
      </span>
      <span style={lineNumStyle}>
        {change.type === 'remove' ? '' : change.newLineNum}
      </span>
      <span style={{ whiteSpace: 'pre', flex: 1 }}>{change.line}</span>
    </div>
  );
}

export default function DiffView({ diff, onApply, onDismiss, applying }: DiffViewProps) {
  const oldLines = useMemo(() => diff.oldCode.split('\n'), [diff.oldCode]);
  const newLines = useMemo(() => diff.newCode.split('\n'), [diff.newCode]);
  const changes = useMemo(() => computeLineDiff(oldLines, newLines), [oldLines, newLines]);

  const addCount = changes.filter(c => c.type === 'add').length;
  const removeCount = changes.filter(c => c.type === 'remove').length;

  return (
    <div style={{
      background: 'var(--vscode-welcomePage-tileBackground, rgba(255,255,255,0.02))',
      border: '1px solid var(--vscode-editorBracketHighlight-foreground1, rgba(0, 122, 255, 0.25))',
      borderRadius: '4px',
      overflow: 'hidden',
      marginTop: '8px',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 10px',
        background: 'rgba(0,0,0,0.1)',
        borderBottom: '1px solid var(--input-border)',
        gap: '8px',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', fontWeight: 'bold', fontFamily: 'monospace' }}>
            {diff.filePath}
          </span>
          <span style={{ fontSize: '10px', color: '#3fb950', background: 'rgba(63,185,80,0.1)', padding: '1px 5px', borderRadius: '3px', border: '1px solid rgba(63,185,80,0.2)' }}>
            +{addCount}
          </span>
          <span style={{ fontSize: '10px', color: '#f85149', background: 'rgba(248,81,73,0.1)', padding: '1px 5px', borderRadius: '3px', border: '1px solid rgba(248,81,73,0.2)' }}>
            -{removeCount}
          </span>
          <span style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)' }}>
            L{diff.startLine}-{diff.endLine}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={onApply}
            disabled={applying}
            style={{
              background: 'var(--vscode-button-background, #007acc)',
              color: 'var(--vscode-button-foreground, #fff)',
              border: 'none',
              padding: '3px 10px',
              borderRadius: '2px',
              fontSize: '10.5px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              opacity: applying ? 0.6 : 1,
            }}
          >
            {applying ? (
              <>
                <svg className="spin" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                  <path fillRule="evenodd" d="M8 2.5a5.5 5.5 0 104.58 2.42l-1.11 1.11A4 4 0 118 4v2.5l3.5-3.5L8 0v2.5z" />
                </svg>
                Menerapkan...
              </>
            ) : (
              <>
                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                  <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                </svg>
                Terapkan Patch
              </>
            )}
          </button>
          <button
            onClick={onDismiss}
            disabled={applying}
            style={{
              background: 'transparent',
              color: 'var(--vscode-descriptionForeground)',
              border: '1px solid var(--input-border)',
              padding: '3px 10px',
              borderRadius: '2px',
              fontSize: '10.5px',
              cursor: 'pointer',
              opacity: applying ? 0.4 : 1,
            }}
          >
            Tolak
          </button>
        </div>
      </div>

      {/* Summary */}
      {diff.summary && (
        <div style={{
          padding: '6px 10px',
          fontSize: '10.5px',
          color: 'var(--vscode-descriptionForeground)',
          borderBottom: '1px solid var(--input-border)',
          background: 'rgba(0,0,0,0.04)',
          fontStyle: 'italic',
          lineHeight: '1.4',
        }}>
          {diff.summary}
        </div>
      )}

      {/* Diff Lines */}
      <div style={{
        ...lineStyles.container,
        padding: '4px 0',
        maxHeight: '300px',
        overflowY: 'auto',
      }}>
        {changes.map((change, idx) => (
          <DiffLine key={idx} change={change} index={idx} />
        ))}
      </div>

      <div style={{
        padding: '4px 10px',
        fontSize: '9px',
        color: 'var(--vscode-descriptionForeground)',
        fontStyle: 'italic',
        borderTop: '1px solid var(--input-border)',
        textAlign: 'center',
      }}>
        Hijau = ditambahkan, Merah = dihapus. Tinjau perubahan sebelum menerapkan.
      </div>
    </div>
  );
}
