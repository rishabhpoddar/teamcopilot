import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import './monacoSetup';

interface MonacoEditorProps {
    value: string;
    readOnly: boolean;
    language: string;
    onChange: (value: string) => void;
}

export default function MonacoEditor({ value, readOnly, language, onChange }: MonacoEditorProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const changeSubscriptionRef = useRef<monaco.IDisposable | null>(null);
    const onChangeRef = useRef(onChange);
    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
        if (!containerRef.current) return;
        const editor = monaco.editor.create(containerRef.current, {
            value: '',
            language: 'plaintext',
            theme: 'vs-dark',
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 13,
            readOnly: false,
            scrollBeyondLastLine: false,
        });
        editorRef.current = editor;
        changeSubscriptionRef.current = editor.onDidChangeModelContent(() => {
            onChangeRef.current(editor.getValue());
        });

        return () => {
            changeSubscriptionRef.current?.dispose();
            editorRef.current?.dispose();
            changeSubscriptionRef.current = null;
            editorRef.current = null;
        };
    }, []);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        if (editor.getValue() !== value) {
            editor.setValue(value);
        }
    }, [value]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.updateOptions({ readOnly });
    }, [readOnly]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const model = editor.getModel();
        if (!model) return;
        monaco.editor.setModelLanguage(model, language);
    }, [language]);

    return <div ref={containerRef} className="workflow-monaco-editor" />;
}
