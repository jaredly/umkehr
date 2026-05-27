import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';

export type TopBarControls = {
    documentPicker?: ReactNode;
    seedControls?: ReactNode;
    archiveControls?: ReactNode;
    statusMessage?: ReactNode;
};

type TopBarContextValue = {
    controls: TopBarControls;
};

const TopBarStateContext = createContext<TopBarContextValue | null>(null);
const TopBarDispatchContext = createContext<((controls: TopBarControls) => void) | null>(null);

export function TopBarProvider({
    children,
}: {
    children: ReactNode;
}) {
    const [controls, setControls] = useState<TopBarControls>({});
    const stateValue = useMemo(() => ({controls}), [controls]);

    return (
        <TopBarDispatchContext.Provider value={setControls}>
            <TopBarStateContext.Provider value={stateValue}>{children}</TopBarStateContext.Provider>
        </TopBarDispatchContext.Provider>
    );
}

export function useTopBarState() {
    const context = useContext(TopBarStateContext);
    if (!context) throw new Error('useTopBarState must be used inside TopBarProvider.');
    return context.controls;
}

export function useTopBarControls(controls: TopBarControls) {
    const setControls = useContext(TopBarDispatchContext);
    if (!setControls) throw new Error('useTopBarControls must be used inside TopBarProvider.');

    useEffect(() => {
        setControls(controls);
        return () => setControls({});
    }, [setControls, controls]);
}
