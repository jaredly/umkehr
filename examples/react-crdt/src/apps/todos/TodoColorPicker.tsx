import {useValue} from 'umkehr/react';
import type {AppEditorContext} from '../../lib/crdtApp';
import type {TodoState} from './model';

const pastelColors = ['#fff', '#fce7f3', '#dbeafe', '#dcfce7', '#fef3c7', '#ede9fe'] as const;

export function TodoColorPicker({
    editor,
    readOnly,
}: {
    editor: AppEditorContext<TodoState>;
    readOnly: boolean;
}) {
    const bgcolor = useValue(editor.$.bgcolor);

    return (
        <section
            className="colorPicker"
            aria-label="Task background color"
            onMouseLeave={() => editor.clearPreview()}
        >
            {pastelColors.map((color) => (
                <button
                    key={color}
                    type="button"
                    className={color === bgcolor ? 'swatch selected' : 'swatch'}
                    style={{backgroundColor: color}}
                    title={color}
                    aria-label={`Use ${color}`}
                    onClick={() => editor.$.bgcolor(color)}
                    onMouseEnter={() => {
                        if (!readOnly) editor.$.bgcolor(color, 'preview');
                    }}
                    disabled={readOnly}
                />
            ))}
        </section>
    );
}
