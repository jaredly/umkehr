We've got some perf regression tests failing.

```
 FAIL  examples/block-rich-text/src/App.test.tsx > Block rich text example UI > pastes 2000 characters into a comment body after commenting large text in less than 50ms
AssertionError: expected 101.51070800000161 to be less than 50

 FAIL  examples/block-rich-text/src/typingPerf.test.ts > block rich text typing performance > keeps a moderate sequential typing workload responsive
AssertionError: expected 259.64641699999993 to be less than 120

 FAIL  examples/block-rich-text/src/typingPerf.test.ts > block rich text typing performance > pastes 4000 characters as plain text in less than 20ms
AssertionError: expected 29.867292000000816 to be less than 20
```

Can you look into what changed recently that regressed performance?