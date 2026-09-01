/**
 * dsh-vaspflow client: file list — port of FileList.tsx (list + preview modal).
 */
import React, { useEffect, useState, useCallback } from 'react';
import { List, Spin, Empty, Typography, Tooltip, Modal } from 'antd';
import { FileTextOutlined, FolderOutlined, FileOutlined, EyeOutlined } from '@ant-design/icons';
import { fetchFileContent, fetchTaskFiles } from './api';
import type { TaskDirEntry, TaskFileEntry } from './api';

const { Text } = Typography;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtIcon(ext: string) {
  const extUpper = ext.toUpperCase();
  if (['.POSCAR', '.CONTCAR', '.VASP', '.XDATCAR'].includes(extUpper)) return <FileTextOutlined style={{ color: '#1677ff' }} />;
  if (['.OUTCAR', '.OSZICAR', '.INCAR', '.KPOINTS', '.POTCAR'].includes(extUpper)) return <FileTextOutlined style={{ color: '#52c41a' }} />;
  if (['.EIGENVAL', '.DOSCAR', '.CHGCAR', '.PROCAR'].includes(extUpper)) return <FileTextOutlined style={{ color: '#faad14' }} />;
  return <FileOutlined style={{ color: '#999' }} />;
}

function isTextFile(ext: string): boolean {
  const textExts = ['.txt', '.log', '.csv', '.json', '.xml', '.sh', '.py', '.js', '.ts', '.md',
    '.INCAR', '.KPOINTS', '.POSCAR', '.CONTCAR', '.POTCAR',
    '.OUTCAR', '.OSZICAR', '.EIGENVAL', '.DOSCAR', '.XDATCAR',
    '.CHGCAR', '.PROCAR', '.REPORT', '.PCDAT', '.IBZKPT', '.vasp'];
  return textExts.includes(ext.toUpperCase()) || ext.length <= 5;
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

  useEffect(() => {
    setLoading(true);
    fetchTaskFiles(taskId)
      .then((data) => {
        setFiles(data.files || []);
        setDirs(data.dirs || []);
      })
      .catch(() => { setFiles([]); setDirs([]); })
      .finally(() => setLoading(false));
  }, [taskId]);

  const handleFileClick = useCallback(async (f: TaskFileEntry) => {
    if (!isTextFile(f.ext)) return;
    setPreviewName(f.name);
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewContent('');
    try {
      const data = await fetchFileContent(taskId, f.name);
      setPreviewContent(data.content || '');
      setPreviewTruncated(data.truncated || false);
    } catch {
      setPreviewContent('[无法读取文件内容]');
    } finally {
      setPreviewLoading(false);
    }
  }, [taskId]);

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
            style={{ padding: '2px 8px', cursor: isTextFile(f.ext) ? 'pointer' : 'default' }}
            onClick={() => handleFileClick(f)}
          >
            <Tooltip title={f.name}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, maxWidth: '100%' }}>
                {getExtIcon(f.ext)}
                <Text ellipsis style={{ flex: 1, fontSize: 12 }}>{f.name}</Text>
                <Text type="secondary" style={{ fontSize: 10, flexShrink: 0 }}>{formatSize(f.size)}</Text>
                {isTextFile(f.ext) && <EyeOutlined style={{ fontSize: 11, color: '#bbb', flexShrink: 0 }} />}
              </span>
            </Tooltip>
          </List.Item>
        )}
      />

      <Modal
        title={previewName}
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={null}
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
                ⚠ 文件过大，仅显示尾部 500KB
              </div>
            )}
          </pre>
        )}
      </Modal>
    </div>
  );
};

export default FileList;
