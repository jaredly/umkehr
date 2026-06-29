import type {IValidation} from 'typia';
import typia from 'typia';
import {hlc} from 'umkehr/crdt';

export type Coord = {
    x: number;
    y: number;
};

export type JigsawState = {
    positions: Record<string, Coord>;
    connections: Record<string, number>;
};

export const JIGSAW_DOC_ID = 'umkehr-react-crdt-jigsaw-v1';
export const jigsawSchema = typia.json.schemas<[JigsawState], '3.1'>();
export const validateJigsawState: (input: unknown) => IValidation<JigsawState> =
    typia.createValidate<JigsawState>();

export const initialJigsawState: JigsawState = {
    positions: {},
    connections: {},
};

export const initialJigsawTimestamp = hlc.pack(hlc.init('seed', 0));
