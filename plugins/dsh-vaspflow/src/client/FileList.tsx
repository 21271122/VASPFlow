/**
 * dsh-vaspflow client: file list — port of FileList.tsx (list + preview modal).
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { List, Spin, Empty, Typography, Tooltip, Modal, Button, Space } from 'antd';
import { FileTextOutlined, FolderOutlined, FileOutlined, EyeOutlined } from '@ant-design/icons';
import { fetchFileContent, fetchTaskFiles } from './api';
import type { TaskDirEntry, TaskFileEntry } from './api';

const { Text } = Typography;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtIcon(ext: string, name: string) {
  const extUpper = (ext || `.${name}`).toUpperCase();
  if (['.POSCAR', '.CONTCAR', '.VASP', '.XDATCAR'].includes(extUpper)) return <FileTextOutlined style={{ color: '#1677ff' }} />;
  if (['.OUTCAR', '.OSZICAR', '.INCAR', '.KPOINTS', '.POTCAR'].includes(extUpper)) return <FileTextOutlined style={{ color: '#52c41a' }} />;
  if (['.EIGENVAL', '.DOSCAR', '.CHGCAR', '.PROCAR'].includes(extUpper)) return <FileTextOutlined style={{ color: '#faad14' }} />;
  return <FileOutlined style={{ color: '#999' }} />;
}

function isTextFile(ext: string, name: string): boolean {
  const textExts = ['.txt', '.log', '.csv', '.json', '.xml', '.sh', '.py', '.js', '.ts', '.md',
    '.INCAR', '.KPOINTS', '.POSCAR', '.CONTCAR', '.POTCAR',
    '.OUTCAR', '.OSZICAR', '.EIGENVAL', '.DOSCAR', '.XDATCAR',
    '.CHGCAR', '.PROCAR', '.REPORT', '.PCDAT', '.IBZKPT', '.vasp'];
  const upperName = name.toUpperCase();
  const standardTextNames = new Set(['INCAR', 'KPOINTS', 'POSCAR', 'CONTCAR', 'POTCAR', 'OUTCAR', 'OSZICAR', 'EIGENVAL', 'DOSCAR', 'XDATCAR', 'CHGCAR', 'PROCAR', 'REPORT', 'PCDAT', 'IBZKPT']);
  return textExts.includes(ext.toUpperCase()) || standardTextNames.has(upperName) || Boolean(ext && ext.length <= 5);
}

const FileList: React.FC<{ taskId: number }> = ({ taskId }) => {
  const [files, setFiles] = useState<TaskFileEntry[]>([]);
  const [dirs, setDirs] = useState<TaskDirEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewName, setPreviewName] = useState('');
  const [previewContent, setPreviewContent] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [previewMeta, setPreviewMeta] = useState<{ offset: number; length: number; totalSize: number; hasBefore: boolean; hasAfter: boolean } | null>(null);
  const previewCache = useRef(new Map<string, any>());

  useEffect(() => {
    previewCache.current.clear();
    setLoading(true);
    fetchTaskFiles(taskId)
      .then((data) => {
        setFiles(data.files || []);
        setDirs(data.dirs || []);
      })
      .catch(() => { setFiles([]); setDirs([]); })
      .finally(() => setLoading(false));
  }, [taskId]);

  const loadPreview = useCallback(async (name: string, offset?: number) => {
    const key = `${name}:${offset ?? 'tail'}`;
    const cached = previewCache.current.get(key);
    if (cached) {
      setPreviewContent(cached.content || '');
      setPreviewTruncated(cached.truncated || false);
      setPreviewMeta(cached);
      return;
    }
    setPreviewLoading(true);
    try {
      const data = await fetchFileContent(taskId, name, offset === undefined ? {} : { offset });
      previewCache.current.set(key, data);
      setPreviewContent(data.content || '');
      setPreviewTruncated(data.truncated || false);
      setPreviewMeta(data);
    } catch {
      setPreviewContent('[无法读取文件内容]');
      setPreviewMeta(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [taskId]);

  const handleFileClick = useCallback(async (f: TaskFileEntry) => {
    if (!isTextFile(f.ext, f.name)) return;
    setPreviewName(f.name);
    setPreviewOpen(true);
    setPreviewContent('');
    setPreviewMeta(null);
    await loadPreview(f.name);
  }, [loadPreview]);

  if (loading) return <Spin style={{ display: 'block', margin: '60px auto' }} />;
  if (files.length === 0 && dirs.length === 0) return <Empty description="无法获取文件列表" />;

  return (
    <div style={{ padding: '4px 0' }}>
      {dirs.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>子目录 ({dirs.length})</Text>
          <List
            size="small"
            dataSource={dirs}
            renderItem={(d) => (
              <List.Item style={{ padding: '2px 8px' }}>
                <FolderOutlined style={{ color: '#faad14', marginRight: 6 }} />
                <Text style={{ fontSize: 12 }}>{d.name}</Text>
              </List.Item>
            )}
          />
        </div>
      )}

      <Text type="secondary" style={{ fontSize: 11 }}>文件 ({files.length})</Text>
      <List
        size="small"
        dataSource={files}
        renderItem={(f) => (
          <List.Item
            style={{ padding: '2px 8px', cursor: isTextFile(f.ext, f.name) ? 'pointer' : 'default' }}
            onClick={() => handleFileClick(f)}
          >
            <Tooltip title={f.name}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, maxWidth: '100%' }}>
                {getExtIcon(f.ext, f.name)}
                <Text ellipsis style={{ flex: 1, fontSize: 12 }}>{f.name}</Text>
                <Text type="secondary" style={{ fontSize: 10, flexShrink: 0 }}>{formatSize(f.size)}</Text>
                {isTextFile(f.ext, f.name) && <EyeOutlined style={{ fontSize: 11, color: '#bbb', flexShrink: 0 }} />}
              </span>
            </Tooltip>
          </List.Item>
        )}
      />

      <Modal
        title={previewName}
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={previewMeta ? (
          <Space>
            <Text type="secondary" style={{ fontSize: 11 }}>
              第 {previewMeta.offset + 1}–{previewMeta.offset + previewMeta.length} 字节 / 共 {formatSize(previewMeta.totalSize)}
            </Text>
            <Button size="small" disabled={!previewMeta.hasBefore || previewLoading}
              onClick={() => loadPreview(previewName, Math.max(0, previewMeta.offset - previewMeta.length))}>读取更早内容</Button>
            <Button size="small" disabled={!previewMeta.hasAfter || previewLoading}
              onClick={() => loadPreview(previewName, previewMeta.offset + previewMeta.length)}>读取更晚内容</Button>
          </Space>
        ) : null}
        width={800}
        destroyOnClose
      >
        {previewLoading ? (
          <Spin style={{ display: 'block', margin: '40px auto' }} />
        ) : (
          <pre className="vaspflow-file-preview" style={{
            maxHeight: '60vh', overflow: 'auto',
            background: 'var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #f5f5f5))',
            padding: 12, borderRadius: 4, fontSize: 12, lineHeight: 1.5,
            whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0,
            color: 'var(--dsw-alias-label-primary, inherit)',
          }}>
            {previewContent}
            {previewTruncated && (
              <div style={{ color: '#faad14', marginTop: 8, fontWeight: 'bold' }}>
                ⚠ 此处只显示文件的一个片段；可用下方按钮继续读取
              </div>
            )}
          </pre>
        )}
      </Modal>
    </div>
  );
};

export default FileList;
