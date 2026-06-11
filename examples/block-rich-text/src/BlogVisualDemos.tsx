import {type ReactNode} from 'react';

type MarkerSet = {
    arrow: string;
    accentArrow: string;
    mutedArrow: string;
    warningArrow: string;
};

type ArrowKind = 'default' | 'accent' | 'muted' | 'warning' | 'incidental' | 'ignored';

export function BlogVisualDemos() {
    return (
        <main className="demoShell" aria-labelledby="demoTitle">
            <header className="demoHeader">
                <p>Rich Causal Blocks</p>
                <h1 id="demoTitle">Blog visual demos</h1>
                <span>High-fidelity figures for the CRDT article diagrams.</span>
            </header>
            <div className="demoGallery">
                <DemoFigure
                    id="rga-ordering"
                    index="01"
                    title="Stable character IDs prevent interleaving"
                    summary="Parent pointers form a tree, while deterministic traversal renders concurrent inserts in a stable order."
                >
                    <RgaOrderingFigure />
                </DemoFigure>
                <DemoFigure
                    id="parent-update"
                    index="02"
                    title="A split is a versioned parent update"
                    summary="Moving the first character of the right side to a new block keeps character identity intact."
                >
                    <ParentUpdateSplitFigure />
                </DemoFigure>
                <DemoFigure
                    id="naive-split"
                    index="03"
                    title="Naive split leaves a sibling subtree behind"
                    summary="Only reparenting the split point misses later siblings that are rendered after the cursor."
                >
                    <NaiveSplitFigure />
                </DemoFigure>
                <DemoFigure
                    id="correct-split"
                    index="04"
                    title="Correct split moves following sibling subtrees"
                    summary="The split operation carries the path and the right-side sibling subtrees into the new block."
                >
                    <CorrectSplitFigure />
                </DemoFigure>
                <DemoFigure
                    id="concurrent-split"
                    index="05"
                    title="Concurrent splits expose incidental move conflicts"
                    summary="A later incidental move can overwrite an earlier intentional split if every parent update is plain LWW."
                >
                    <ConcurrentSplitFigure />
                </DemoFigure>
                <DemoFigure
                    id="incidental-resolution"
                    index="06"
                    title="Incidental split metadata preserves both intents"
                    summary="Sibling reparenting carries split-path metadata so a more specific intentional split can win."
                >
                    <IncidentalResolutionFigure />
                </DemoFigure>
                <DemoFigure
                    id="formatting-marks"
                    index="07"
                    title="Formatting marks are anchored to character IDs"
                    summary="Add and remove marks resolve against the current traversal order rather than fragile offsets."
                >
                    <FormattingMarksFigure />
                </DemoFigure>
                <DemoFigure
                    id="block-cycle"
                    index="08"
                    title="Materialization breaks block cycles deterministically"
                    summary="Raw block moves can form a parent cycle, but rendering ignores one edge consistently."
                >
                    <BlockCycleFigure />
                </DemoFigure>
            </div>
        </main>
    );
}

function DemoFigure({
    id,
    index,
    title,
    summary,
    children,
}: {
    id: string;
    index: string;
    title: string;
    summary: string;
    children: ReactNode;
}) {
    const titleId = `${id}-heading`;
    return (
        <section className="demoFigure" aria-labelledby={titleId}>
            <div className="demoFigureHeader">
                <span>{index}</span>
                <div>
                    <h2 id={titleId}>{title}</h2>
                    <p>{summary}</p>
                </div>
            </div>
            <div className="demoFigureBody">{children}</div>
        </section>
    );
}

function SvgCanvas({
    idPrefix,
    title,
    desc,
    viewBox = '0 0 1040 520',
    children,
}: {
    idPrefix: string;
    title: string;
    desc: string;
    viewBox?: string;
    children(markers: MarkerSet): ReactNode;
}) {
    const titleId = `${idPrefix}-svg-title`;
    const descId = `${idPrefix}-svg-desc`;
    const markers = {
        arrow: `url(#${idPrefix}-arrow)`,
        accentArrow: `url(#${idPrefix}-accent-arrow)`,
        mutedArrow: `url(#${idPrefix}-muted-arrow)`,
        warningArrow: `url(#${idPrefix}-warning-arrow)`,
    };

    return (
        <svg
            className="demoSvg"
            role="img"
            aria-labelledby={`${titleId} ${descId}`}
            viewBox={viewBox}
        >
            <title id={titleId}>{title}</title>
            <desc id={descId}>{desc}</desc>
            <defs>
                <marker
                    id={`${idPrefix}-arrow`}
                    markerWidth="10"
                    markerHeight="10"
                    refX="8"
                    refY="5"
                    orient="auto"
                    markerUnits="strokeWidth"
                >
                    <path className="demoArrowMarker" d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
                <marker
                    id={`${idPrefix}-accent-arrow`}
                    markerWidth="10"
                    markerHeight="10"
                    refX="8"
                    refY="5"
                    orient="auto"
                    markerUnits="strokeWidth"
                >
                    <path className="demoAccentArrowMarker" d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
                <marker
                    id={`${idPrefix}-muted-arrow`}
                    markerWidth="10"
                    markerHeight="10"
                    refX="8"
                    refY="5"
                    orient="auto"
                    markerUnits="strokeWidth"
                >
                    <path className="demoMutedArrowMarker" d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
                <marker
                    id={`${idPrefix}-warning-arrow`}
                    markerWidth="10"
                    markerHeight="10"
                    refX="8"
                    refY="5"
                    orient="auto"
                    markerUnits="strokeWidth"
                >
                    <path className="demoWarningArrowMarker" d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
            </defs>
            {children(markers)}
        </svg>
    );
}

function RgaOrderingFigure() {
    const chars = ['t', 'h', 'e', '_', 'r', 'e', 'd', '_', 'd', 'o', 'g'];
    return (
        <SvgCanvas
            idPrefix="rga-ordering"
            title="Causal tree with concurrent red branch before dog branch"
            desc="The figure shows character nodes pointing back to parents and a rendered traversal strip spelling the red dog."
            viewBox="0 0 1040 560"
        >
            {(markers) => (
                <>
                    <text className="demoSvgEyebrow" x="64" y="52">
                        parent pointer tree
                    </text>
                    <CharNode x={220} y={84} label="t" meta="1:A" />
                    <RootNode x={70} y={82} label="block B" />
                    <Arrow x1={220} y1={110} x2={152} y2={110} markers={markers} />
                    <CharNode x={320} y={84} label="h" meta="2:A" />
                    <Arrow x1={320} y1={110} x2={276} y2={110} markers={markers} />
                    <CharNode x={420} y={84} label="e" meta="3:A" />
                    <Arrow x1={420} y1={110} x2={376} y2={110} markers={markers} />
                    <CharNode x={520} y={84} label="_" meta="4:A" />
                    <Arrow x1={520} y1={110} x2={476} y2={110} markers={markers} />

                    <PathArrow d="M 674 202 C 625 176 620 142 574 114" kind="accent" markers={markers} />
                    <PathArrow d="M 674 318 C 628 288 620 205 574 126" markers={markers} />

                    <CharNode x={674} y={180} label="r" meta="5:B" variant="accent" />
                    <CharNode x={774} y={180} label="e" meta="6:B" variant="accent" />
                    <Arrow x1={774} y1={206} x2={730} y2={206} kind="accent" markers={markers} />
                    <CharNode x={874} y={180} label="d" meta="7:B" variant="accent" />
                    <Arrow x1={874} y1={206} x2={830} y2={206} kind="accent" markers={markers} />
                    <CharNode x={974} y={180} label="_" meta="8:B" variant="accent" />
                    <Arrow x1={974} y1={206} x2={930} y2={206} kind="accent" markers={markers} />

                    <CharNode x={674} y={296} label="d" meta="5:A" variant="warm" />
                    <CharNode x={774} y={296} label="o" meta="6:A" variant="warm" />
                    <Arrow x1={774} y1={322} x2={730} y2={322} markers={markers} />
                    <CharNode x={874} y={296} label="g" meta="7:A" variant="warm" />
                    <Arrow x1={874} y1={322} x2={830} y2={322} markers={markers} />

                    <Callout
                        x={66}
                        y={232}
                        width={404}
                        title="Sibling order under _ 4:A"
                        lines={[
                            'Children are sorted by stable Lamport IDs.',
                            'The B branch renders before the A branch.',
                        ]}
                    />

                    <text className="demoSvgEyebrow" x="64" y="430">
                        rendered traversal order
                    </text>
                    <RenderedStrip x={64} y={452} chars={chars} accents={{4: 'accent', 5: 'accent', 6: 'accent', 7: 'accent', 8: 'warm', 9: 'warm', 10: 'warm'}} />
                    <PathArrow
                        d="M 100 522 H 880"
                        kind="muted"
                        markers={markers}
                    />
                    <text className="demoSvgNote" x="902" y="527">
                        the red dog
                    </text>
                </>
            )}
        </SvgCanvas>
    );
}

function ParentUpdateSplitFigure() {
    return (
        <SvgCanvas
            idPrefix="parent-update"
            title="Split before d by changing d parent to B2"
            desc="The figure stacks the before state above the after state, where d is reparented to B2."
            viewBox="0 0 1040 900"
        >
            {(markers) => (
                <>
                    <Panel x={54} y={64} width={932} height={292} title="before">
                        <RootNode x={107} y={86} label="B1" />
                        <BlockSequence x={120} y={184} chars={['t', 'h', 'e', '_', 'd', 'o', 'g']} />
                        <SequenceBackPointers x={120} y={184} count={7} markers={markers} firstParent />
                    </Panel>
                    <Callout
                        x={230}
                        y={382}
                        width={580}
                        title="split before d"
                        lines={['The cursor sits before d, but the character ID for d is retained.']}
                    />
                    <Panel x={54} y={500} width={440} height={280} title="after: block B1">
                        <RootNode x={107} y={520} label="B1" />
                        <BlockSequence x={120} y={610} chars={['t', 'h', 'e', '_']} />
                        <SequenceBackPointers x={120} y={610} count={4} markers={markers} firstParent />
                    </Panel>
                    <Panel x={546} y={500} width={440} height={280} title="after: block B2">
                        <RootNode x={613} y={520} label="B2" />
                        <BlockSequence x={626} y={610} chars={['d', 'o', 'g']} accents={{0: 'accent'}} />
                        <SequenceBackPointers
                            x={626}
                            y={610}
                            count={3}
                            kind="accent"
                            markers={markers}
                            firstParent
                        />
                        <Callout
                            x={650}
                            y={696}
                            width={282}
                            title="d.parent := B2"
                            lines={['d becomes the first child of B2.']}
                            compact
                        />
                    </Panel>
                </>
            )}
        </SvgCanvas>
    );
}

function NaiveSplitFigure() {
    return (
        <SvgCanvas
            idPrefix="naive-split"
            title="Naive split moves red but leaves dog behind"
            desc="The figure contrasts the intended split with a naive split where the sibling dog subtree remains in block B1."
            viewBox="0 0 1040 1320"
        >
            {(markers) => (
                <>
                    <Panel x={54} y={58} width={934} height={360} title="before tree">
                        <MiniTree x={232} y={94} scale={0.68} />
                        <Callout
                            x={566}
                            y={146}
                            width={300}
                            title="rendered text"
                            lines={['the red dog is one block before the split.']}
                            compact
                        />
                    </Panel>
                    <Panel x={54} y={468} width={934} height={270} title="user's intended rendered result">
                        <BlockTextBox x={168} y={558} width={250} label="B1" text="the " />
                        <BlockTextBox x={540} y={558} width={270} label="B2" text="red dog" variant="accent" />
                        <Callout
                            x={352}
                            y={654}
                            width={336}
                            title="cursor intent"
                            lines={['Everything after the cursor moves right.']}
                            compact
                        />
                    </Panel>
                    <Panel x={54} y={788} width={934} height={440} title="naive after tree">
                        <NaiveAfterTree x={212} y={838} markers={markers} scale={0.72} />
                        <Callout
                            x={600}
                            y={930}
                            width={270}
                            title="bug"
                            lines={['dog stayed behind', 'as a sibling of r.']}
                            compact
                        />
                    </Panel>
                </>
            )}
        </SvgCanvas>
    );
}

function CorrectSplitFigure() {
    return (
        <SvgCanvas
            idPrefix="correct-split"
            title="Correct split moves split path and following siblings"
            desc="The figure stacks the before tree, dog reparenting, red reparenting, and final sequence."
            viewBox="0 0 1040 1900"
        >
            {(markers) => (
                <>
                    <Panel x={54} y={58} width={934} height={360} title="before">
                        <MiniTree x={232} y={94} scale={0.68} />
                        <Callout
                            x={566}
                            y={146}
                            width={290}
                            title="split before r"
                            lines={['The cursor is before red.']}
                            compact
                        />
                    </Panel>
                    <Panel x={54} y={468} width={934} height={500} title="1. reparent dog onto the end of red">
                        <DogAttachedToRedTree x={238} y={508} markers={markers} scale={0.58} />
                        <Callout
                            x={624}
                            y={582}
                            width={304}
                            title="dog.parent := tail(red)"
                            lines={['The following sibling subtree moves first.']}
                            compact
                        />
                    </Panel>
                    <Panel x={54} y={1018} width={934} height={430} title="2. reparent red to B2">
                        <CorrectAfterTree x={238} y={1060} markers={markers} includeDog scale={0.68} />
                        <Callout
                            x={624}
                            y={1144}
                            width={300}
                            title="red.parent := B2"
                            lines={['The red subtree carries dog with it.']}
                            compact
                        />
                    </Panel>
                    <Panel x={54} y={1498} width={934} height={310} title="final rendered order">
                        <BlockTextBox x={168} y={1592} width={260} label="B1" text="the" />
                        <BlockTextBox x={540} y={1592} width={300} label="B2" text="red dog" variant="accent" />
                        <Callout
                            x={314}
                            y={1708}
                            width={412}
                            title="rendered result"
                            lines={['The split keeps the left prefix and moves the right side.']}
                            compact
                        />
                    </Panel>
                </>
            )}
        </SvgCanvas>
    );
}

function ConcurrentSplitFigure() {
    return (
        <SvgCanvas
            idPrefix="concurrent-split"
            title="Concurrent intentional and incidental splits conflict under LWW"
            desc="The figure shows both replica intents and the incorrect last-write-wins result with B3 empty."
            viewBox="0 0 1040 1640"
        >
            {(markers) => (
                <>
                    <Panel x={54} y={64} width={934} height={440} title="Replica A: split before dog">
                        <SplitBeforeDogTree x={206} y={108} markers={markers} scale={0.68} />
                        <Tag x={650} y={150} label="B1: the red" variant="accent" width={130} />
                        <Tag x={650} y={194} label="dog: intentional" variant="warning" width={156} />
                        <Callout
                            x={650}
                            y={252}
                            width={260}
                            title="A"
                            lines={['dog starts its own block B3.']}
                            compact
                        />
                    </Panel>
                    <Panel x={54} y={554} width={934} height={440} title="Replica B: split before red">
                        <CorrectAfterTree x={196} y={598} markers={markers} includeDog scale={0.68} />
                        <Tag x={650} y={640} label="red: intentional" variant="accent" width={150} />
                        <Tag x={650} y={684} label="dog: incidental" variant="warm" width={150} />
                        <Callout
                            x={650}
                            y={742}
                            width={260}
                            title="B"
                            lines={['red starts B2; dog is pulled along.']}
                            compact
                        />
                    </Panel>
                    <Panel x={54} y={1044} width={934} height={440} title="plain LWW merge">
                        <LwwConflictTree x={150} y={1088} markers={markers} scale={0.68} />
                        <Tag x={650} y={1128} label="B3: empty" variant="warning" width={116} />
                        <Tag x={650} y={1172} label="lost split" variant="warning" width={112} />
                        <Callout
                            x={650}
                            y={1230}
                            width={350}
                            title="later timestamp wins"
                            lines={['B incidental move overwrites', 'A intentional split before dog.']}
                            compact
                        />
                    </Panel>
                </>
            )}
        </SvgCanvas>
    );
}

function IncidentalResolutionFigure() {
    return (
        <SvgCanvas
            idPrefix="incidental-resolution"
            title="Incidental metadata lets the more specific split win"
            desc="The figure shows tagged replica states and the final merge where B3 keeps dog."
            viewBox="0 0 1040 1640"
        >
            {(markers) => (
                <>
                    <Panel x={54} y={64} width={934} height={440} title="Replica A: split before dog">
                        <SplitBeforeDogTree x={206} y={108} markers={markers} scale={0.68} />
                        <Tag x={650} y={150} label="B1: the red" variant="accent" width={130} />
                        <Tag x={650} y={194} label="dog: intentional" variant="warning" width={156} />
                        <Tag x={650} y={238} label="dog.parent := B3" variant="warning" width={170} />
                    </Panel>
                    <Panel x={54} y={554} width={934} height={440} title="Replica B: tagged split before red">
                        <CorrectAfterTree x={196} y={598} markers={markers} includeDog scale={0.68} />
                        <Tag x={650} y={640} label="red: intentional" variant="accent" width={150} />
                        <Tag x={650} y={684} label="dog: incidental" variant="warm" width={150} />
                        <Tag x={650} y={728} label="splitPath: [B1, _, r]" variant="muted" width={220} />
                    </Panel>
                    <Panel x={54} y={1044} width={934} height={440} title="merged materialization">
                        <ResolvedConcurrentSplitTree x={162} y={1088} markers={markers} scale={0.68} />
                        <Tag x={650} y={1128} label="intentional wins" variant="warning" width={156} />
                        <Callout
                            x={650}
                            y={1186}
                            width={380}
                            title="A's dog split wins"
                            lines={['B incidental metadata yields to A intentional split before dog.']}
                            compact
                        />
                    </Panel>
                </>
            )}
        </SvgCanvas>
    );
}

function FormattingMarksFigure() {
    const chars = ['t', 'h', 'e', '_', 'r', 'e', 'd', '_', 'd', 'o', 'g'];
    return (
        <SvgCanvas
            idPrefix="formatting-marks"
            title="Formatting marks resolve from character ID anchors"
            desc="The figure shows add and remove bold records, their anchored ranges, and the resolved spans."
            viewBox="0 0 1040 610"
        >
            {() => (
                <>
                    <text className="demoSvgEyebrow" x="66" y="64">
                        character order
                    </text>
                    <RenderedStrip
                        x={66}
                        y={90}
                        chars={chars}
                        meta={['1:A', '2:A', '3:A', '4:A', '5:B', '6:B', '7:B', '8:B', '5:A', '6:A', '7:A']}
                        accents={{4: 'accent', 5: 'accent', 6: 'accent', 7: 'accent'}}
                    />
                    <RangeBand x={242} y={174} width={168} label="M1 add: red_" variant="accent" />
                    <RangeBand x={286} y={226} width={80} label="M2: ed" variant="warning" />

                    <Callout
                        x={706}
                        y={76}
                        width={266}
                        title="raw mark records"
                        lines={[
                            'M1: start before r, end after _',
                            'M2: start before e, end after d',
                        ]}
                    />

                    <text className="demoSvgEyebrow" x="66" y="342">
                        resolved spans
                    </text>
                    <g transform="translate(66 376) scale(1.15)">
                        <ResolvedSpan x={0} y={0} width={210} label="plain" text="the " />
                        <ResolvedSpan x={210} y={0} width={86} label="bold" text="r" variant="accent" />
                        <ResolvedSpan x={296} y={0} width={140} label="plain" text="ed" />
                        <ResolvedSpan x={436} y={0} width={86} label="bold" text="_" variant="accent" />
                        <ResolvedSpan x={522} y={0} width={210} label="plain" text="dog" />
                    </g>
                    <Callout
                        x={66}
                        y={500}
                        width={616}
                        title="split-aware traversal"
                        lines={['Marks keep character-ID anchors as text splits, joins, and moves reshape the document.']}
                    />
                </>
            )}
        </SvgCanvas>
    );
}

function BlockCycleFigure() {
    return (
        <SvgCanvas
            idPrefix="block-cycle"
            title="A raw parent cycle materializes by ignoring one edge"
            desc="The figure shows A and B pointing at each other, then root to A to B with one ignored raw edge."
            viewBox="0 0 1040 500"
        >
            {(markers) => (
                <>
                    <Panel x={58} y={70} width={410} height={360} title="raw graph">
                        <BlockNode x={178} y={154} label="A" />
                        <BlockNode x={178} y={278} label="B" />
                        <PathArrow d="M 260 180 C 334 190 334 270 260 286" kind="accent" markers={markers} />
                        <PathArrow d="M 178 286 C 104 270 104 190 178 180" kind="warning" markers={markers} />
                        <CodeCallout
                            x={278}
                            y={150}
                            width={138}
                            lines={['A.parent = B', 'B.parent = A']}
                            compact
                        />
                    </Panel>
                    <Panel x={572} y={70} width={410} height={360} title="materialized order">
                        <RootNode x={628} y={130} label="root" />
                        <BlockNode x={750} y={130} label="A" />
                        <BlockNode x={750} y={270} label="B" />
                        <Arrow x1={750} y1={158} x2={710} y2={158} markers={markers} />
                        <Arrow x1={790} y1={270} x2={790} y2={204} markers={markers} />
                        <PathArrow d="M 830 158 C 914 180 914 274 830 296" kind="ignored" markers={markers} />
                        <text className="demoSvgNote" x="844" y="236">
                            ignored edge
                        </text>
                        <Callout
                            x={616}
                            y={334}
                            width={318}
                            title="deterministic tie-break"
                            lines={['Every replica ignores the same cycle edge.']}
                            compact
                        />
                    </Panel>
                </>
            )}
        </SvgCanvas>
    );
}

function Panel({
    x,
    y,
    width,
    height,
    title,
    children,
}: {
    x: number;
    y: number;
    width: number;
    height: number;
    title: string;
    children: ReactNode;
}) {
    return (
        <g>
            <rect className="demoPanelBox" x={x} y={y} width={width} height={height} rx="12" />
            <text className="demoPanelTitle" x={x + 18} y={y + 32}>
                {title}
            </text>
            {children}
        </g>
    );
}

function RootNode({x, y, label}: {x: number; y: number; label: string}) {
    return (
        <g transform={`translate(${x} ${y})`}>
            <rect className="demoRootNode" width="80" height="56" rx="14" />
            <text className="demoNodeMain" x="40" y="28" textAnchor="middle" dominantBaseline="middle">
                {label}
            </text>
        </g>
    );
}

function BlockNode({x, y, label}: {x: number; y: number; label: string}) {
    return (
        <g transform={`translate(${x} ${y})`}>
            <rect className="demoBlockNode" width="80" height="56" rx="12" />
            <text className="demoNodeMain" x="40" y="28" textAnchor="middle" dominantBaseline="middle">
                {label}
            </text>
        </g>
    );
}

function CharNode({
    x,
    y,
    label,
    meta,
    variant,
}: {
    x: number;
    y: number;
    label: string;
    meta?: string;
    variant?: 'accent' | 'warm' | 'warning' | 'muted';
}) {
    const className = ['demoCharNode', variant ? `demoCharNode-${variant}` : '']
        .filter(Boolean)
        .join(' ');
    return (
        <g transform={`translate(${x} ${y})`}>
            <rect className={className} width="54" height="52" rx="12" />
            <text className="demoCharText" x="27" y={meta ? 21 : 26} textAnchor="middle" dominantBaseline="middle">
                {label}
            </text>
            {meta ? (
                <text className="demoCharMeta" x="27" y="39" textAnchor="middle">
                    {meta}
                </text>
            ) : null}
        </g>
    );
}

function Arrow({
    x1,
    y1,
    x2,
    y2,
    kind = 'default',
    markers,
}: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    kind?: ArrowKind;
    markers: MarkerSet;
}) {
    return (
        <line
            className={arrowClass(kind)}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            markerEnd={arrowMarker(kind, markers)}
        />
    );
}

function PathArrow({
    d,
    kind = 'default',
    markers,
}: {
    d: string;
    kind?: ArrowKind;
    markers: MarkerSet;
}) {
    return <path className={arrowClass(kind)} d={d} markerEnd={arrowMarker(kind, markers)} />;
}

function arrowClass(kind: ArrowKind) {
    return ['demoArrow', `demoArrow-${kind}`].join(' ');
}

function arrowMarker(kind: ArrowKind, markers: MarkerSet) {
    if (kind === 'accent') return markers.accentArrow;
    if (kind === 'warning') return markers.warningArrow;
    if (kind === 'muted' || kind === 'ignored') return markers.mutedArrow;
    return markers.arrow;
}

function BlockSequence({
    x,
    y,
    label,
    chars,
    accents = {},
}: {
    x: number;
    y: number;
    label?: string;
    chars: string[];
    accents?: Record<number, 'accent' | 'warm' | 'warning' | 'muted'>;
}) {
    return (
        <g>
            {label ? (
                <text className="demoBlockLabel" x={x} y={y - 18}>
                    {label}
                </text>
            ) : null}
            {chars.map((char, index) => (
                <CharNode key={`${char}-${index}`} x={x + index * 100} y={y} label={char} variant={accents[index]} />
            ))}
        </g>
    );
}

function SequenceBackPointers({
    x,
    y,
    count,
    markers,
    kind = 'default',
    firstParent = false,
}: {
    x: number;
    y: number;
    count: number;
    markers: MarkerSet;
    kind?: ArrowKind;
    firstParent?: boolean;
}) {
    return (
        <g>
            {firstParent ? (
                <Arrow
                    x1={x + 27}
                    y1={y}
                    x2={x + 27}
                    y2={y - 42}
                    kind={kind}
                    markers={markers}
                />
            ) : null}
            {Array.from({length: Math.max(0, count - 1)}, (_, index) => {
                const childX = x + (index + 1) * 100;
                const parentX = x + index * 100 + 54;
                return (
                    <Arrow
                        key={index}
                        x1={childX}
                        y1={y + 26}
                        x2={parentX}
                        y2={y + 26}
                        kind={kind}
                        markers={markers}
                    />
                );
            })}
        </g>
    );
}

function RenderedStrip({
    x,
    y,
    chars,
    meta,
    accents = {},
}: {
    x: number;
    y: number;
    chars: string[];
    meta?: string[];
    accents?: Record<number, 'accent' | 'warm' | 'warning' | 'muted'>;
}) {
    return (
        <g>
            {chars.map((char, index) => (
                <g key={`${char}-${index}`} transform={`translate(${x + index * 44} ${y})`}>
                    <rect
                        className={[
                            'demoStripChar',
                            accents[index] ? `demoStripChar-${accents[index]}` : '',
                        ]
                            .filter(Boolean)
                            .join(' ')}
                        width="36"
                        height={meta ? 54 : 40}
                        rx="8"
                    />
                    <text className="demoStripText" x="18" y={meta ? 19 : 22} textAnchor="middle" dominantBaseline="middle">
                        {char}
                    </text>
                    {meta ? (
                        <text className="demoStripMeta" x="18" y="41" textAnchor="middle">
                            {meta[index]}
                        </text>
                    ) : null}
                </g>
            ))}
        </g>
    );
}

function BlockTextBox({
    x,
    y,
    width = 210,
    label,
    text,
    variant,
}: {
    x: number;
    y: number;
    width?: number;
    label: string;
    text: string;
    variant?: 'accent' | 'warm' | 'warning' | 'muted';
}) {
    const className = ['demoTextBlock', variant ? `demoTextBlock-${variant}` : '']
        .filter(Boolean)
        .join(' ');
    return (
        <g transform={`translate(${x} ${y})`}>
            <text className="demoBlockLabel" x="0" y="-14">
                {label}
            </text>
            <rect className={className} width={width} height="64" rx="12" />
            <text className="demoTextBlockText" x={width / 2} y="34" textAnchor="middle" dominantBaseline="middle">
                {text}
            </text>
        </g>
    );
}

function Callout({
    x,
    y,
    width,
    title,
    lines,
    compact = false,
}: {
    x: number;
    y: number;
    width: number;
    title: string;
    lines: string[];
    compact?: boolean;
}) {
    const height = compact ? 54 + lines.length * 18 : 68 + lines.length * 22;
    return (
        <g transform={`translate(${x} ${y})`}>
            <rect className="demoCallout" width={width} height={height} rx="12" />
            <text className="demoCalloutTitle" x="18" y="28">
                {title}
            </text>
            {lines.map((line, index) => (
                <text
                    key={line}
                    className="demoCalloutLine"
                    x="18"
                    y={compact ? 52 + index * 18 : 60 + index * 22}
                >
                    {line}
                </text>
            ))}
        </g>
    );
}

function CodeCallout({
    x,
    y,
    width,
    lines,
    compact = false,
}: {
    x: number;
    y: number;
    width: number;
    lines: string[];
    compact?: boolean;
}) {
    const height = compact ? 34 + lines.length * 22 : 44 + lines.length * 26;
    return (
        <g transform={`translate(${x} ${y})`}>
            <rect className="demoCodeCallout" width={width} height={height} rx="12" />
            {lines.map((line, index) => (
                <text key={line} className="demoCodeLine" x="18" y={compact ? 30 + index * 22 : 36 + index * 26}>
                    {line}
                </text>
            ))}
        </g>
    );
}

function Tag({
    x,
    y,
    label,
    variant,
    width,
}: {
    x: number;
    y: number;
    label: string;
    variant: 'accent' | 'warning' | 'muted' | 'warm';
    width?: number;
}) {
    const tagWidth = width ?? Math.max(92, label.length * 8 + 28);
    return (
        <g transform={`translate(${x} ${y})`}>
            <rect className={`demoTag demoTag-${variant}`} width={tagWidth} height="32" rx="16" />
            <text className="demoTagText" x={tagWidth / 2} y="21" textAnchor="middle">
                {label}
            </text>
        </g>
    );
}

function MiniTree({
    x,
    y,
    highlight = false,
    scale = 0.58,
}: {
    x: number;
    y: number;
    highlight?: boolean;
    scale?: number;
}) {
    return (
        <g transform={`translate(${x} ${y}) scale(${scale})`}>
            <CharNode x={0} y={0} label="t" />
            <CharNode x={0} y={62} label="h" />
            <CharNode x={0} y={124} label="e" />
            <CharNode x={0} y={186} label="_" />
            <CharNode x={-42} y={248} label="r" variant="accent" />
            <CharNode x={-42} y={310} label="e" variant="accent" />
            <CharNode x={-42} y={372} label="d" variant="accent" />
            <CharNode x={-42} y={434} label="_" variant="accent" />
            <CharNode x={54} y={248} label="d" variant={highlight ? 'warning' : 'warm'} />
            <CharNode x={54} y={310} label="o" variant={highlight ? 'warning' : 'warm'} />
            <CharNode x={54} y={372} label="g" variant={highlight ? 'warning' : 'warm'} />
            <line className="demoMiniEdge" x1="27" y1="52" x2="27" y2="62" />
            <line className="demoMiniEdge" x1="27" y1="114" x2="27" y2="124" />
            <line className="demoMiniEdge" x1="27" y1="176" x2="27" y2="186" />
            <line className="demoMiniEdge" x1="22" y1="238" x2="-14" y2="248" />
            <line className="demoMiniEdge" x1="32" y1="238" x2="80" y2="248" />
        </g>
    );
}

function NaiveAfterTree({
    x,
    y,
    markers,
    scale = 0.56,
}: {
    x: number;
    y: number;
    markers: MarkerSet;
    scale?: number;
}) {
    return (
        <g transform={`translate(${x} ${y}) scale(${scale})`}>
            <RootNode x={-16} y={0} label="B1" />
            <CharNode x={0} y={82} label="t" />
            <CharNode x={0} y={144} label="h" />
            <CharNode x={0} y={206} label="e" />
            <CharNode x={0} y={268} label="_" />
            <CharNode x={74} y={330} label="d" variant="warning" />
            <CharNode x={74} y={392} label="o" variant="warning" />
            <CharNode x={74} y={454} label="g" variant="warning" />

            <RootNode x={170} y={0} label="B2" />
            <CharNode x={184} y={82} label="r" variant="accent" />
            <CharNode x={184} y={144} label="e" variant="accent" />
            <CharNode x={184} y={206} label="d" variant="accent" />
            <CharNode x={184} y={268} label="_" variant="accent" />

            <VerticalBackPointers x={0} y={82} count={4} markers={markers} firstParent />
            <PathArrow d="M 101 330 C 82 314 62 300 27 320" kind="warning" markers={markers} />
            <VerticalBackPointers x={74} y={330} count={3} kind="warning" markers={markers} />
            <VerticalBackPointers x={184} y={82} count={4} kind="accent" markers={markers} firstParent />
        </g>
    );
}

function CorrectAfterTree({
    x,
    y,
    markers,
    includeDog,
    scale = 0.58,
}: {
    x: number;
    y: number;
    markers: MarkerSet;
    includeDog: boolean;
    scale?: number;
}) {
    return (
        <g transform={`translate(${x} ${y}) scale(${scale})`}>
            <RootNode x={-16} y={0} label="B1" />
            <CharNode x={0} y={82} label="t" />
            <CharNode x={0} y={144} label="h" />
            <CharNode x={0} y={206} label="e" />
            <CharNode x={0} y={268} label="_" />
            <VerticalBackPointers x={0} y={82} count={4} markers={markers} firstParent />

            <RootNode x={190} y={0} label="B2" />
            <CharNode x={204} y={82} label="r" variant="accent" />
            <CharNode x={204} y={144} label="e" variant="accent" />
            <CharNode x={204} y={206} label="d" variant="accent" />
            <CharNode x={204} y={268} label="_" variant="accent" />
            <VerticalBackPointers x={204} y={82} count={4} kind="accent" markers={markers} firstParent />

            {includeDog ? (
                <>
                    <CharNode x={204} y={330} label="d" variant="warm" />
                    <CharNode x={204} y={392} label="o" variant="warm" />
                    <CharNode x={204} y={454} label="g" variant="warm" />
                    <VerticalBackPointers x={204} y={330} count={3} kind="warning" markers={markers} />
                    <Arrow x1={231} y1={330} x2={231} y2={320} kind="warning" markers={markers} />
                </>
            ) : null}
        </g>
    );
}

function DogAttachedToRedTree({
    x,
    y,
    markers,
    scale = 0.58,
}: {
    x: number;
    y: number;
    markers: MarkerSet;
    scale?: number;
}) {
    return (
        <g transform={`translate(${x} ${y}) scale(${scale})`}>
            <RootNode x={-16} y={0} label="B1" />
            <CharNode x={0} y={82} label="t" />
            <CharNode x={0} y={144} label="h" />
            <CharNode x={0} y={206} label="e" />
            <CharNode x={0} y={268} label="_" />
            <VerticalBackPointers x={0} y={82} count={4} markers={markers} firstParent />

            <CharNode x={110} y={330} label="r" variant="accent" />
            <CharNode x={110} y={392} label="e" variant="accent" />
            <CharNode x={110} y={454} label="d" variant="accent" />
            <CharNode x={110} y={516} label="_" variant="accent" />
            <PathArrow d="M 137 330 C 104 306 70 302 40 320" kind="accent" markers={markers} />
            <VerticalBackPointers x={110} y={330} count={4} kind="accent" markers={markers} />

            <CharNode x={110} y={578} label="d" variant="warm" />
            <CharNode x={110} y={640} label="o" variant="warm" />
            <CharNode x={110} y={702} label="g" variant="warm" />
            <VerticalBackPointers x={110} y={578} count={3} kind="warning" markers={markers} />
            <Arrow x1={137} y1={578} x2={137} y2={568} kind="warning" markers={markers} />

            <RootNode x={360} y={0} label="B2" />
            <text className="demoSvgNote" x="374" y="100">
                empty
            </text>
        </g>
    );
}

function SplitBeforeDogTree({
    x,
    y,
    markers,
    scale = 0.58,
}: {
    x: number;
    y: number;
    markers: MarkerSet;
    scale?: number;
}) {
    return (
        <g transform={`translate(${x} ${y}) scale(${scale})`}>
            <RootNode x={-16} y={0} label="B1" />
            <CharNode x={0} y={82} label="t" />
            <CharNode x={0} y={144} label="h" />
            <CharNode x={0} y={206} label="e" />
            <CharNode x={0} y={268} label="_" />
            <VerticalBackPointers x={0} y={82} count={4} markers={markers} firstParent />

            <CharNode x={110} y={330} label="r" variant="accent" />
            <CharNode x={110} y={392} label="e" variant="accent" />
            <CharNode x={110} y={454} label="d" variant="accent" />
            <CharNode x={110} y={516} label="_" variant="accent" />
            <PathArrow d="M 137 330 C 104 306 70 302 40 320" kind="accent" markers={markers} />
            <VerticalBackPointers x={110} y={330} count={4} kind="accent" markers={markers} />

            <RootNode x={360} y={0} label="B3" />
            <CharNode x={374} y={82} label="d" variant="warning" />
            <CharNode x={374} y={144} label="o" variant="warning" />
            <CharNode x={374} y={206} label="g" variant="warning" />
            <VerticalBackPointers x={374} y={82} count={3} kind="warning" markers={markers} firstParent />
        </g>
    );
}

function LwwConflictTree({
    x,
    y,
    markers,
    scale = 0.58,
}: {
    x: number;
    y: number;
    markers: MarkerSet;
    scale?: number;
}) {
    return (
        <g transform={`translate(${x} ${y}) scale(${scale})`}>
            <CorrectAfterTree x={0} y={0} markers={markers} includeDog scale={1} />
            <RootNode x={470} y={0} label="B3" />
            <text className="demoSvgNote" x="484" y="100">
                empty
            </text>
        </g>
    );
}

function ResolvedConcurrentSplitTree({
    x,
    y,
    markers,
    scale = 0.58,
}: {
    x: number;
    y: number;
    markers: MarkerSet;
    scale?: number;
}) {
    return (
        <g transform={`translate(${x} ${y}) scale(${scale})`}>
            <RootNode x={-16} y={0} label="B1" />
            <CharNode x={0} y={82} label="t" />
            <CharNode x={0} y={144} label="h" />
            <CharNode x={0} y={206} label="e" />
            <CharNode x={0} y={268} label="_" />
            <VerticalBackPointers x={0} y={82} count={4} markers={markers} firstParent />

            <RootNode x={220} y={0} label="B2" />
            <CharNode x={234} y={82} label="r" variant="accent" />
            <CharNode x={234} y={144} label="e" variant="accent" />
            <CharNode x={234} y={206} label="d" variant="accent" />
            <CharNode x={234} y={268} label="_" variant="accent" />
            <VerticalBackPointers x={234} y={82} count={4} kind="accent" markers={markers} firstParent />

            <RootNode x={440} y={0} label="B3" />
            <CharNode x={454} y={82} label="d" variant="warning" />
            <CharNode x={454} y={144} label="o" variant="warning" />
            <CharNode x={454} y={206} label="g" variant="warning" />
            <VerticalBackPointers x={454} y={82} count={3} kind="warning" markers={markers} firstParent />
        </g>
    );
}

function VerticalBackPointers({
    x,
    y,
    count,
    markers,
    kind = 'default',
    firstParent = false,
}: {
    x: number;
    y: number;
    count: number;
    markers: MarkerSet;
    kind?: ArrowKind;
    firstParent?: boolean;
}) {
    return (
        <g>
            {firstParent ? (
                <Arrow x1={x + 27} y1={y} x2={x + 27} y2={56} kind={kind} markers={markers} />
            ) : null}
            {Array.from({length: Math.max(0, count - 1)}, (_, index) => {
                const childY = y + (index + 1) * 62;
                const parentY = y + index * 62 + 52;
                return (
                    <Arrow
                        key={index}
                        x1={x + 27}
                        y1={childY}
                        x2={x + 27}
                        y2={parentY}
                        kind={kind}
                        markers={markers}
                    />
                );
            })}
        </g>
    );
}

function RangeBand({
    x,
    y,
    width,
    label,
    variant,
}: {
    x: number;
    y: number;
    width: number;
    label: string;
    variant: 'accent' | 'warning';
}) {
    return (
        <g transform={`translate(${x} ${y})`}>
            <path className={`demoRangeBand demoRangeBand-${variant}`} d={`M 0 0 H ${width} V 26 H 0 Z`} />
            <text className="demoRangeLabel" x={width / 2} y="17" textAnchor="middle">
                {label}
            </text>
        </g>
    );
}

function ResolvedSpan({
    x,
    y,
    width,
    label,
    text,
    variant,
}: {
    x: number;
    y: number;
    width: number;
    label: string;
    text: string;
    variant?: 'accent';
}) {
    return (
        <g transform={`translate(${x} ${y})`}>
            <rect
                className={['demoResolvedSpan', variant ? `demoResolvedSpan-${variant}` : '']
                    .filter(Boolean)
                    .join(' ')}
                width={width}
                height="62"
                rx="10"
            />
            <text className="demoResolvedLabel" x={width / 2} y="20" textAnchor="middle">
                {label}
            </text>
            <text
                className={['demoResolvedText', variant ? `demoResolvedText-${variant}` : '']
                    .filter(Boolean)
                    .join(' ')}
                x={width / 2}
                y="43"
                textAnchor="middle"
            >
                {text}
            </text>
        </g>
    );
}
