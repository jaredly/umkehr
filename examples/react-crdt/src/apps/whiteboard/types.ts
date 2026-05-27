import type {AppEditorContext} from '../../lib/crdtApp';
import type {
    StrokePoint,
    WhiteboardElementPreviewData,
    WhiteboardEphemeralData,
    WhiteboardState,
} from './model';

export type WhiteboardEditorContext = AppEditorContext<
    WhiteboardState,
    'type',
    WhiteboardEphemeralData
>;

export type ActiveStroke = {
    id: string;
    points: StrokePoint[];
};

export type LocalElementPreview = WhiteboardElementPreviewData;

export type DragState =
    | null
    | {
          kind: 'move';
          id: string;
          pointerId: number;
          offsetX: number;
          offsetY: number;
      }
    | {
          kind: 'resize-note';
          id: string;
          pointerId: number;
          originX: number;
          originY: number;
      }
    | {
          kind: 'pan';
          pointerId: number;
          startX: number;
          startY: number;
          panX: number;
          panY: number;
      };
