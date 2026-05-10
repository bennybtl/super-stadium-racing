const n=`{
  "id": "fandango",
  "packId": "offroad_pack_1",
  "name": "Fandango",
  "image": "fandango.jpg",
  "width": 160,
  "depth": 160,
  "defaultTerrainType": "packed_dirt",
  "borderTerrainType": "packed_dirt",
  "wear": {
    "enabled": true,
    "source": "aiPath",
    "width": 3.2,
    "intensity": 0.28,
    "laneSpacing": 1.3,
    "alphaBreakup": 0.48,
    "pathWander": 0.72,
    "edgeSoftness": 0.75,
    "secondaryPathCount": 59,
    "secondaryPathStrength": 0.62,
    "secondaryPathSpacing": 0.13,
    "seed": 1337
  },
  "features": [
    {
      "type": "meshGrid",
      "centerX": 0,
      "centerZ": 0,
      "width": 160,
      "depth": 160,
      "cols": 9,
      "rows": 9,
      "heights": [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        3,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        3,
        0,
        0,
        0,
        6,
        6,
        6,
        4.5,
        0,
        0,
        0,
        0,
        0,
        10,
        10,
        10,
        7.5,
        -0.5,
        0,
        8,
        6.5,
        8,
        10,
        10,
        10,
        8,
        6.5,
        1.5,
        20,
        20,
        20,
        10,
        10,
        11,
        17,
        20,
        20,
        20,
        20,
        20,
        18,
        18,
        16.5,
        18,
        20,
        20,
        24,
        24,
        24,
        24,
        24,
        24,
        24,
        24,
        24,
        24,
        24,
        24,
        24,
        24,
        24,
        24,
        24,
        24
      ],
      "smoothing": 0.4
    },
    {
      "type": "checkpoint",
      "centerX": -59,
      "centerZ": -41,
      "heading": 6.099999999999986,
      "width": 25.5,
      "checkpointNumber": 1,
      "passedBy": {}
    },
    {
      "type": "squareHill",
      "centerX": -29,
      "centerZ": 29.5,
      "width": 15,
      "depth": 11,
      "transition": 4,
      "terrainType": null,
      "heightAtMin": 3,
      "heightAtMax": -1.5,
      "angle": 0
    },
    {
      "type": "hill",
      "centerX": -6,
      "centerZ": 28,
      "radius": 4,
      "height": 2.5,
      "terrainType": "loose_dirt"
    },
    {
      "type": "hill",
      "centerX": -14,
      "centerZ": 33.5,
      "radius": 6,
      "height": 2.5,
      "terrainType": "loose_dirt"
    },
    {
      "type": "polyWall",
      "points": [
        {
          "x": -2,
          "z": 40,
          "smoothing": 0,
          "radius": 5.5
        },
        {
          "x": -2,
          "z": -32,
          "smoothing": 0,
          "radius": 4
        },
        {
          "x": -46,
          "z": -32,
          "smoothing": 0,
          "radius": 10
        },
        {
          "x": -46,
          "z": -40.56512786309756,
          "smoothing": 0,
          "radius": 10
        },
        {
          "x": 48,
          "z": -40,
          "smoothing": 0,
          "radius": 10
        },
        {
          "x": 48,
          "z": -32,
          "smoothing": 0,
          "radius": 10
        },
        {
          "x": 2,
          "z": -32,
          "smoothing": 0,
          "radius": 4
        },
        {
          "x": 2,
          "z": 40,
          "smoothing": 0,
          "radius": 5
        },
        {
          "x": 60,
          "z": 40,
          "radius": 5
        },
        {
          "x": 60,
          "z": 60,
          "radius": 8.5
        },
        {
          "x": -58,
          "z": 60,
          "radius": 9.5
        },
        {
          "x": -58,
          "z": 40,
          "radius": 4
        }
      ],
      "height": 2,
      "thickness": 0.5,
      "friction": 0.1,
      "closed": true
    },
    {
      "type": "polyWall",
      "points": [
        {
          "x": -76,
          "z": 22,
          "radius": 5
        },
        {
          "x": -20,
          "z": 20,
          "smoothing": 0,
          "radius": 5.5
        },
        {
          "x": -20,
          "z": -8,
          "smoothing": 0,
          "radius": 4
        },
        {
          "x": -72,
          "z": -16,
          "smoothing": 0,
          "radius": 10
        },
        {
          "x": -74,
          "z": -56,
          "smoothing": 0,
          "radius": 10
        },
        {
          "x": -62,
          "z": -70.5,
          "smoothing": 0,
          "radius": 10
        },
        {
          "x": 76,
          "z": -72,
          "smoothing": 0,
          "radius": 10
        },
        {
          "x": 76,
          "z": -10,
          "smoothing": 0,
          "radius": 10
        },
        {
          "x": 20,
          "z": -6,
          "smoothing": 0,
          "radius": 5
        },
        {
          "x": 20,
          "z": 22,
          "smoothing": 0,
          "radius": 5
        },
        {
          "x": 76,
          "z": 22,
          "smoothing": 0,
          "radius": 10
        },
        {
          "x": 76,
          "z": 78,
          "radius": 6
        },
        {
          "x": -76,
          "z": 78,
          "radius": 9
        }
      ],
      "height": 3,
      "thickness": 0.5,
      "friction": 0.1,
      "closed": true
    },
    {
      "type": "checkpoint",
      "centerX": -11,
      "centerZ": -6,
      "heading": 0,
      "width": 16,
      "checkpointNumber": 2,
      "passedBy": {}
    },
    {
      "type": "checkpoint",
      "centerX": 0.4738422189265883,
      "centerZ": -60.01407625122488,
      "heading": -1.5707963267948966,
      "width": 19.5,
      "checkpointNumber": 8,
      "passedBy": {}
    },
    {
      "type": "hill",
      "centerX": -72.5,
      "centerZ": 26.789914757934966,
      "radius": 3,
      "height": 1,
      "terrainType": "loose_dirt"
    },
    {
      "type": "hill",
      "centerX": -67,
      "centerZ": 31.289914757934966,
      "radius": 5.5,
      "height": 2,
      "terrainType": "loose_dirt"
    },
    {
      "type": "hill",
      "centerX": -68,
      "centerZ": 68.78991475793497,
      "radius": 6,
      "height": 2,
      "terrainType": "loose_dirt"
    },
    {
      "type": "hill",
      "centerX": -30,
      "centerZ": 74,
      "radius": 7.5,
      "height": 3,
      "terrainType": "loose_dirt"
    },
    {
      "type": "hill",
      "centerX": -43,
      "centerZ": 74,
      "radius": 5.5,
      "height": 1.5,
      "terrainType": "loose_dirt"
    },
    {
      "type": "hill",
      "centerX": 68.5,
      "centerZ": 28,
      "radius": 7,
      "height": 2,
      "terrainType": "loose_dirt"
    },
    {
      "type": "squareHill",
      "centerX": 24,
      "centerZ": -20,
      "width": 0.5,
      "depth": 23,
      "height": 1,
      "transition": 0.5,
      "terrainType": null,
      "angle": 180
    },
    {
      "type": "hill",
      "centerX": 68.5,
      "centerZ": -18,
      "radius": 9,
      "height": -1.5,
      "terrainType": "mud"
    },
    {
      "type": "hill",
      "centerX": 66,
      "centerZ": -64.5,
      "radius": 10,
      "height": -3.5,
      "terrainType": "mud"
    },
    {
      "type": "hill",
      "centerX": -66.5,
      "centerZ": -56,
      "radius": 5.5,
      "height": -2,
      "terrainType": "mud"
    },
    {
      "type": "hill",
      "centerX": -54,
      "centerZ": -65,
      "radius": 7.5,
      "height": -2,
      "terrainType": "mud"
    },
    {
      "type": "hill",
      "centerX": -54,
      "centerZ": -20.5,
      "radius": 6,
      "height": 2,
      "terrainType": "packed_dirt"
    },
    {
      "type": "hill",
      "centerX": -44,
      "centerZ": -16,
      "radius": 6,
      "height": 2,
      "terrainType": "packed_dirt"
    },
    {
      "type": "squareHill",
      "centerX": -48,
      "centerZ": 30.224786894837415,
      "width": 5,
      "depth": 11,
      "height": -3,
      "transition": 4,
      "terrainType": null
    },
    {
      "type": "squareHill",
      "centerX": 28,
      "centerZ": 68.22478689483742,
      "width": 10,
      "depth": 10,
      "transition": 4,
      "terrainType": null,
      "heightAtMin": 0,
      "heightAtMax": 3
    },
    {
      "type": "hill",
      "centerX": 12,
      "centerZ": 31.289914757934973,
      "radius": 10,
      "height": 1,
      "terrainType": "loose_dirt"
    },
    {
      "type": "hill",
      "centerX": 48.5,
      "centerZ": -62.710085242065034,
      "radius": 10,
      "height": 1.5,
      "terrainType": "loose_dirt"
    },
    {
      "type": "squareHill",
      "centerX": 6,
      "centerZ": 68.72478689483742,
      "width": 10,
      "depth": 10,
      "transition": 4,
      "terrainType": null,
      "heightAtMin": 0,
      "heightAtMax": 3
    },
    {
      "type": "checkpoint",
      "centerX": -67,
      "centerZ": 45,
      "heading": 0,
      "width": 16.5,
      "checkpointNumber": 3,
      "passedBy": {}
    },
    {
      "type": "checkpoint",
      "centerX": -2,
      "centerZ": 69,
      "heading": 1.550000000000001,
      "width": 16,
      "checkpointNumber": 4,
      "passedBy": {}
    },
    {
      "type": "checkpoint",
      "centerX": 68,
      "centerZ": 43,
      "heading": 3.149999999999997,
      "width": 14,
      "checkpointNumber": 5,
      "passedBy": {}
    },
    {
      "type": "checkpoint",
      "centerX": 11,
      "centerZ": 1,
      "heading": 3.049999999999997,
      "width": 16,
      "checkpointNumber": 6,
      "passedBy": {}
    },
    {
      "type": "checkpoint",
      "centerX": 62,
      "centerZ": -37,
      "heading": 3.141592653589793,
      "width": 25,
      "checkpointNumber": 7,
      "passedBy": {}
    },
    {
      "type": "actionZone",
      "zoneType": "pickupSpawn",
      "x": 64.5,
      "z": -59.27521310516259,
      "shape": "circle",
      "width": 30,
      "depth": 30,
      "rotation": 0,
      "radius": 15
    },
    {
      "type": "actionZone",
      "zoneType": "pickupSpawn",
      "x": 12.5,
      "z": 29.724786894837408,
      "shape": "circle",
      "width": 30,
      "depth": 30,
      "rotation": 0,
      "radius": 15
    },
    {
      "type": "actionZone",
      "zoneType": "pickupSpawn",
      "x": 65,
      "z": 32.224786894837415,
      "shape": "circle",
      "width": 30,
      "depth": 30,
      "rotation": 0,
      "radius": 15
    },
    {
      "type": "actionZone",
      "zoneType": "pickupSpawn",
      "x": 64,
      "z": 66,
      "shape": "circle",
      "width": 30,
      "depth": 30,
      "rotation": 0,
      "radius": 15
    },
    {
      "type": "actionZone",
      "zoneType": "pickupSpawn",
      "x": -36,
      "z": 69.22478689483741,
      "shape": "circle",
      "width": 30,
      "depth": 30,
      "rotation": 0,
      "radius": 15
    },
    {
      "type": "actionZone",
      "zoneType": "pickupSpawn",
      "x": -65,
      "z": 31.224786894837415,
      "shape": "circle",
      "width": 30,
      "depth": 30,
      "rotation": 0,
      "radius": 15
    },
    {
      "type": "actionZone",
      "zoneType": "pickupSpawn",
      "x": -15.5,
      "z": -21.775213105162592,
      "shape": "circle",
      "width": 30,
      "depth": 30,
      "rotation": 0,
      "radius": 15
    },
    {
      "type": "squareHill",
      "centerX": 29.5,
      "centerZ": -20,
      "width": 0.5,
      "depth": 23,
      "height": 1,
      "transition": 0.5,
      "terrainType": null,
      "angle": 180
    },
    {
      "type": "squareHill",
      "centerX": 35.4708230739412,
      "centerZ": -20,
      "width": 0.5,
      "depth": 23,
      "height": 1,
      "transition": 0.5,
      "terrainType": null,
      "angle": 180
    },
    {
      "type": "squareHill",
      "centerX": 41.499815923925695,
      "centerZ": -20.01799803348255,
      "width": 0.5,
      "depth": 23,
      "height": 1,
      "transition": 0.5,
      "terrainType": null,
      "angle": 180
    },
    {
      "type": "trackSign",
      "x": -36.923248428015924,
      "z": 45.95126928619483,
      "name": "Track Name",
      "rotation": 0.15707963267948966,
      "contentType": "brand",
      "brandImage": "energizer-racing.png",
      "background": "black",
      "scale": 2.05,
      "heightOffset": 2.6,
      "width": 14.5
    },
    {
      "type": "trackSign",
      "x": -0.4232484280159241,
      "z": 44.95126928619483,
      "name": "Track Name",
      "rotation": 0,
      "contentType": "brand",
      "brandImage": "luck-dice.png",
      "background": "red",
      "scale": 2.05,
      "heightOffset": 2.6,
      "width": 15
    },
    {
      "type": "trackSign",
      "x": 35.576751571984076,
      "z": 47.95126928619483,
      "name": "Track Name",
      "rotation": -0.15707963267948966,
      "contentType": "brand",
      "brandImage": "phoenix-auto.png",
      "background": "white",
      "scale": 1.95,
      "heightOffset": 2.4,
      "width": 14
    },
    {
      "type": "trackSign",
      "x": 0.06645078796845816,
      "z": -37.75485788055321,
      "name": "Track Name",
      "rotation": 0,
      "contentType": "brand",
      "brandImage": "ultra-grip.png",
      "background": "black",
      "scale": 2.5,
      "heightOffset": 0,
      "width": 10
    },
    {
      "type": "aiPath",
      "points": [
        {
          "x": -0.2457166646753145,
          "z": -60.046589265551596
        },
        {
          "x": -44.88933473170838,
          "z": -57.12003582414858
        },
        {
          "x": -60.507582243615985,
          "z": -41.19777503756841
        },
        {
          "x": -48.72348049417797,
          "z": -25.357728040106302
        },
        {
          "x": -15.13,
          "z": -15.88
        },
        {
          "x": -7.608764833711654,
          "z": 8.269875727215684
        },
        {
          "x": -21.739961222946555,
          "z": 29.958632910146733
        },
        {
          "x": -62.9059015343195,
          "z": 30.70809881125902
        },
        {
          "x": -71.8635094298748,
          "z": 47.94107669588827
        },
        {
          "x": -59.41,
          "z": 67.01
        },
        {
          "x": -11.52,
          "z": 62.68000000000001
        },
        {
          "x": 55.07,
          "z": 69.37
        },
        {
          "x": 70.98874086961587,
          "z": 50.112358560772655
        },
        {
          "x": 53.25,
          "z": 27.11
        },
        {
          "x": 24.47138264941928,
          "z": 34.42582715551876
        },
        {
          "x": 7.524075094936352,
          "z": 10.141786190086659
        },
        {
          "x": 18,
          "z": -18.8
        },
        {
          "x": 50.4,
          "z": -22.6
        },
        {
          "x": 63.93,
          "z": -35.97
        },
        {
          "x": 41.24,
          "z": -58.01
        }
      ]
    },
    {
      "type": "trackSign",
      "x": -37.59538121978289,
      "z": -74.7884958810415,
      "name": "Fandango",
      "rotation": 0,
      "contentType": "text",
      "brandImage": "energizer-racing.png",
      "background": "black",
      "scale": 1.35,
      "heightOffset": 1.9,
      "width": 12
    },
    {
      "type": "actionZone",
      "zoneType": "outOfBounds",
      "shape": "polygon",
      "x": 10.29696630210627,
      "z": 48.8676952897148,
      "radius": 15,
      "points": [
        {
          "x": -56.8328765039321,
          "z": 41.23020291285864
        },
        {
          "x": 19.753173870212457,
          "z": 39.99013280068608
        },
        {
          "x": 54.04586574907237,
          "z": 40.24714003253979
        },
        {
          "x": 58.99966247487396,
          "z": 42.535876271826695
        },
        {
          "x": 60.09539235110858,
          "z": 52.725153948927506
        },
        {
          "x": 53.89887649820339,
          "z": 60.13240123373852
        },
        {
          "x": -50.4732763629725,
          "z": 60.07676706846695
        },
        {
          "x": -57.11108765971597,
          "z": 54.00388804867427
        }
      ]
    },
    {
      "type": "actionZone",
      "zoneType": "outOfBounds",
      "shape": "polygon",
      "x": 0.5078020351527528,
      "z": -19.63929724621159,
      "radius": 15,
      "points": [
        {
          "x": -45.052513985475976,
          "z": -36.819556197494904
        },
        {
          "x": -41.54054318459411,
          "z": -40.44418547855196
        },
        {
          "x": 44.48334204547579,
          "z": -39.77817605905676
        },
        {
          "x": 47.375195243191484,
          "z": -36.47359374301289
        },
        {
          "x": 44.14118547932802,
          "z": -33.556840407870766
        },
        {
          "x": 2.163166959019912,
          "z": -32.039286000503566
        },
        {
          "x": 1.7053591242014532,
          "z": 44.12546278444138
        },
        {
          "x": -2.096528685606848,
          "z": 43.522136564104756
        },
        {
          "x": -2.299458307312439,
          "z": -31.740888962170345
        },
        {
          "x": -43.801184336699755,
          "z": -33.18804496200086
        }
      ]
    },
    {
      "type": "polyHill",
      "points": [
        {
          "x": -17.553008617528196,
          "z": -50.56426484094207,
          "radius": 0
        },
        {
          "x": -8.18848330275221,
          "z": -71.79006017640182,
          "radius": 0
        },
        {
          "x": 8.826059655924729,
          "z": -72.60591317231996,
          "radius": 0
        },
        {
          "x": 18.72040298940837,
          "z": -50.79494169981391,
          "radius": 0
        }
      ],
      "height": 4,
      "width": 9,
      "terrainType": null,
      "closed": true,
      "filled": true
    },
    {
      "type": "obstacle",
      "obstacleType": "softWall",
      "x": 8.031529791555544,
      "z": -47.129355097963035,
      "angle": -1.5707963267948966,
      "scale": 1.1,
      "weight": 80,
      "color": "blue"
    },
    {
      "type": "obstacle",
      "obstacleType": "softWall",
      "x": 15.746362353912247,
      "z": -47.16197415389857,
      "angle": -1.5707963267948966,
      "scale": 1.1,
      "weight": 80,
      "color": "red"
    },
    {
      "type": "obstacle",
      "obstacleType": "softWall",
      "x": 0.3041124345699,
      "z": -47.349432209456616,
      "angle": -1.5707963267948966,
      "scale": 1.1,
      "weight": 80,
      "color": "white"
    },
    {
      "type": "obstacle",
      "obstacleType": "softWall",
      "x": -7.393137050022306,
      "z": -47.367588086532564,
      "angle": -1.5707963267948966,
      "scale": 1.1,
      "weight": 80,
      "color": "blue"
    },
    {
      "type": "obstacle",
      "obstacleType": "softWall",
      "x": -14.947105479408638,
      "z": -47.54882164518627,
      "angle": -1.6057029118347832,
      "scale": 1.1,
      "weight": 80,
      "color": "red"
    }
  ]
}`;export{n as default};
