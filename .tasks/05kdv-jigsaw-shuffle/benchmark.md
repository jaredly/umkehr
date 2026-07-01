# Jigsaw Packing Benchmark

Mode: quick

| algorithm | count | type | tabs | seed | subset | ms | placed | max distance | p95 distance | mean distance | max overlap | overlap violations | outside violations | attempts |
| --- | ---: | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| currentRingLane | 120 | rectangular | no | 1 | all | 13.7 | 120 | 486.1 | 386.4 | 188.0 | 0 | 0 | 0 |  |
| bestFirstGrid | 120 | rectangular | no | 1 | all | 20.6 | 120 | 334.9 | 291.6 | 115.4 | 0 | 0 | 0 | 29936 |
| perimeterShelves | 120 | rectangular | no | 1 | all | 0.4 | 120 | 171.1 | 160 | 78.2 | 0 | 0 | 0 | 131 |
| currentRingLane | 120 | rectangular | yes | 1 | all | 2.9 | 120 | 678.8 | 517.1 | 259.3 | 0 | 0 | 0 |  |
| bestFirstGrid | 120 | rectangular | yes | 1 | all | 16.2 | 120 | 452.4 | 421.3 | 208.5 | 0 | 0 | 0 | 29432 |
| perimeterShelves | 120 | rectangular | yes | 1 | all | 0.1 | 120 | 388.9 | 309.3 | 149.1 | 0 | 0 | 0 | 133 |
| currentRingLane | 120 | voronoi | no | 1 | all | 2.0 | 120 | 621.0 | 452.7 | 223.4 | 0 | 0 | 0 |  |
| bestFirstGrid | 120 | voronoi | no | 1 | all | 6.8 | 120 | 332.7 | 278.4 | 130.8 | 0 | 0 | 0 | 15592 |
| perimeterShelves | 120 | voronoi | no | 1 | all | 0.1 | 120 | 318.8 | 290.3 | 171.7 | 0 | 0 | 0 | 131 |
| currentRingLane | 120 | voronoi | yes | 1 | all | 2.1 | 120 | 624.1 | 453.7 | 232.2 | 0 | 0 | 0 |  |
| bestFirstGrid | 120 | voronoi | yes | 1 | all | 9.6 | 120 | 447.2 | 336.9 | 163.6 | 0 | 0 | 0 | 17823 |
| perimeterShelves | 120 | voronoi | yes | 1 | all | 0.1 | 120 | 505.7 | 388.5 | 184.0 | 0 | 0 | 0 | 132 |
| currentRingLane | 600 | rectangular | no | 1 | all | 428.2 | 600 | 735.0 | 535.5 | 266.7 | 0 | 0 | 0 |  |
| bestFirstGrid | 600 | rectangular | no | 1 | all | 392.0 | 600 | 318.7 | 244.8 | 131.7 | 0 | 0 | 0 | 821318 |
| perimeterShelves | 600 | rectangular | no | 1 | all | 0.3 | 600 | 299.1 | 239.8 | 129.6 | 0 | 0 | 0 | 627 |
| currentRingLane | 600 | rectangular | yes | 1 | all | 317.1 | 600 | 833.0 | 594.6 | 319.7 | 0 | 0 | 0 |  |
| bestFirstGrid | 600 | rectangular | yes | 1 | all | 377.3 | 600 | 538.8 | 443.3 | 239.1 | 0 | 0 | 0 | 838018 |
| perimeterShelves | 600 | rectangular | yes | 1 | all | 0.4 | 600 | 476.2 | 372.3 | 205.6 | 0 | 0 | 0 | 629 |
| currentRingLane | 600 | voronoi | no | 1 | all | 246.0 | 600 | 787.2 | 558.3 | 304.3 | 0 | 0 | 0 |  |
| bestFirstGrid | 600 | voronoi | no | 1 | all | 202.1 | 600 | 391.5 | 318.8 | 168.6 | 0 | 0 | 0 | 435151 |
| perimeterShelves | 600 | voronoi | no | 1 | all | 0.2 | 600 | 540.7 | 447.7 | 251.7 | 0 | 0 | 0 | 627 |
| currentRingLane | 600 | voronoi | yes | 1 | all | 245.4 | 600 | 790.9 | 586.6 | 324.6 | 0 | 0 | 0 |  |
| bestFirstGrid | 600 | voronoi | yes | 1 | all | 276.8 | 600 | 453.0 | 380.6 | 206.7 | 0 | 0 | 0 | 504537 |
| perimeterShelves | 600 | voronoi | yes | 1 | all | 0.3 | 600 | 634.2 | 464.1 | 263.4 | 0 | 0 | 0 | 628 |
| currentRingLane | 1000 | rectangular | no | 1 | all | 2189.6 | 1000 | 1014.3 | 789.3 | 397.1 | 0 | 0 | 0 |  |
| bestFirstGrid | 1000 | rectangular | no | 1 | all | 1166.4 | 1000 | 314.2 | 248.8 | 132.0 | 0 | 0 | 0 | 2266657 |
| perimeterShelves | 1000 | rectangular | no | 1 | all | 0.4 | 1000 | 387.0 | 282.8 | 155.7 | 0 | 0 | 0 | 1036 |
| currentRingLane | 1000 | rectangular | yes | 1 | all | 1300.3 | 1000 | 951.4 | 669.5 | 368.1 | 0 | 0 | 0 |  |
| bestFirstGrid | 1000 | rectangular | yes | 1 | all | 1196.5 | 1000 | 561.1 | 442.3 | 244.1 | 0 | 0 | 0 | 2331353 |
| perimeterShelves | 1000 | rectangular | yes | 1 | all | 0.4 | 1000 | 517.0 | 420.3 | 236.8 | 0 | 0 | 0 | 1039 |
| currentRingLane | 1000 | voronoi | no | 1 | all | 1031.8 | 1000 | 831.6 | 633.5 | 357.0 | 0 | 0 | 0 |  |
| bestFirstGrid | 1000 | voronoi | no | 1 | all | 604.0 | 1000 | 388.5 | 322.0 | 173.4 | 0 | 0 | 0 | 1178943 |
| perimeterShelves | 1000 | voronoi | no | 1 | all | 0.5 | 1000 | 610.9 | 507.2 | 289.0 | 0 | 0 | 0 | 1035 |
| currentRingLane | 1000 | voronoi | yes | 1 | all | 1008.6 | 1000 | 924.4 | 671.0 | 376.1 | 0 | 0 | 0 |  |
| bestFirstGrid | 1000 | voronoi | yes | 1 | all | 623.5 | 1000 | 492.4 | 385.8 | 209.5 | 0 | 0 | 0 | 1330555 |
| perimeterShelves | 1000 | voronoi | yes | 1 | all | 0.4 | 1000 | 700.5 | 539.6 | 306.7 | 0 | 0 | 0 | 1036 |
