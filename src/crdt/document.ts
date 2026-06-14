import type {IJsonSchemaCollection} from 'typia';
import {materialize} from './materialize.js';
import {buildMeta} from './metadata.js';
import {createLeafPluginRegistry, assertRequiredLeafPlugins} from './plugins.js';
import {collectRequiredLeafPlugins} from './schema.js';
import type {CreateCrdtDocumentOptions, CrdtDocument, JsonValue} from './types.js';

export function createCrdtDocument<T>(
    initial: T,
    collection: IJsonSchemaCollection<'3.1', [T]>,
    options: CreateCrdtDocumentOptions,
): CrdtDocument<T> {
    const root = collection.schemas[options.schemaIndex ?? 0];
    if (!root) {
        throw new Error(
            `Cannot create CRDT document: schema index ${options.schemaIndex ?? 0} is missing.`,
        );
    }
    const leafPlugins = createLeafPluginRegistry(options.leafPlugins);
    const requiredLeafPlugins = collectRequiredLeafPlugins(root, collection.components);
    assertRequiredLeafPlugins(requiredLeafPlugins, leafPlugins);
    const schema = {
        root,
        components: collection.components,
        tagKey: options.tagKey ?? 'type',
        leafPlugins,
        requiredLeafPlugins,
    };
    const meta = buildMeta(initial as JsonValue, root, schema, options.timestamp);
    return {state: materialize(meta, initial, schema) as T, meta, pending: [], schema};
}
