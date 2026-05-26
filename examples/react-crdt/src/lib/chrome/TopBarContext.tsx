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
    setControls(controls: TopBarControls): void;
};

const TopBarContext = createContext<TopBarContextValue | null>(null);

export function TopBarProvider({
    children,
}: {
    children: ReactNode;
}) {
    const [controls, setControls] = useState<TopBarControls>({});
    const value = useMemo(() => ({controls, setControls}), [controls]);

    return <TopBarContext.Provider value={value}>{children}</TopBarContext.Provider>;
}

export function useTopBarState() {
    const context = useContext(TopBarContext);
    if (!context) throw new Error('useTopBarState must be used inside TopBarProvider.');
    return context.controls;
}

export function useTopBarControls(controls: TopBarControls) {
    const context = useContext(TopBarContext);
    if (!context) throw new Error('useTopBarControls must be used inside TopBarProvider.');
    const {setControls} = context;

    useEffect(() => {
        setControls(controls);
        return () => setControls({});
    }, [setControls, controls]);
}
