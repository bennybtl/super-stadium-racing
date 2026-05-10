const n=`{
  "id": "blaster",
  "packId": "offroad_pack_1",
  "name": "Blaster",
  "image": "blaster.jpg",
  "width": 160,
  "depth": 160,
  "defaultTerrainType": "packed_dirt",
  "borderTerrainType": "packed_dirt",
  "wear": {
    "enabled": true,
    "source": "aiPath",
    "width": 3.2,
    "intensity": 0.32,
    "laneSpacing": 1.4,
    "alphaBreakup": 0.73,
    "pathWander": 0.96,
    "edgeSoftness": 0.75,
    "secondaryPathCount": 63,
    "secondaryPathStrength": 0.88,
    "secondaryPathSpacing": 0.1,
    "seed": 1337
  },
  "features": [
    {
      "type": "polyHill",
      "points": [
        {
          "x": 5,
          "z": -79.56512786309756,
          "radius": 0
        },
        {
          "x": -7.5,
          "z": -61.56512786309756,
          "radius": 17
        },
        {
          "x": -9,
          "z": 66.43487213690244,
          "radius": 12
        },
        {
          "x": 9,
          "z": 79.93487213690244,
          "radius": 0
        }
      ],
      "height": 5.5,
      "width": 14.5,
      "closed": false
    },
    {
      "type": "polyHill",
      "points": [
        {
          "x": 25.5,
          "z": -62.56512786309756,
          "radius": 0
        },
        {
          "x": 17.5,
          "z": -50.06512786309756,
          "radius": 23.5
        },
        {
          "x": 19.5,
          "z": 37.43487213690245,
          "radius": 19
        },
        {
          "x": 30.5,
          "z": 44.43487213690245,
          "radius": 0
        }
      ],
      "height": 5.5,
      "width": 14,
      "closed": false
    },
    {
      "type": "polyWall",
      "points": [
        {
          "x": -12,
          "z": 4,
          "radius": 5.5
        },
        {
          "x": -50,
          "z": 4,
          "radius": 6
        },
        {
          "x": -50,
          "z": -12,
          "radius": 7.5
        },
        {
          "x": -12,
          "z": -12,
          "radius": 3.5
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
          "x": -12,
          "z": 30,
          "radius": 0
        },
        {
          "x": -36,
          "z": 30,
          "radius": 7.5
        },
        {
          "x": -36,
          "z": 80,
          "radius": 12.5
        },
        {
          "x": -80,
          "z": 80,
          "radius": 20.5
        },
        {
          "x": -78,
          "z": -36,
          "radius": 16
        },
        {
          "x": -13,
          "z": -37,
          "radius": 0
        }
      ],
      "height": 2,
      "thickness": 0.5,
      "friction": 0.1,
      "closed": false
    },
    {
      "type": "hill",
      "centerX": -56,
      "centerZ": 0,
      "radius": 10,
      "height": 3,
      "terrainType": null
    },
    {
      "type": "hill",
      "centerX": -58,
      "centerZ": 18,
      "radius": 8,
      "height": 5,
      "terrainType": "rocky"
    },
    {
      "type": "hill",
      "centerX": -62,
      "centerZ": 34,
      "radius": 6.5,
      "height": 5,
      "terrainType": "rocky"
    },
    {
      "type": "hill",
      "centerX": -56,
      "centerZ": 44,
      "radius": 7.5,
      "height": 2,
      "terrainType": "loose_dirt"
    },
    {
      "type": "hill",
      "centerX": -50,
      "centerZ": 28,
      "radius": 6.5,
      "height": 6,
      "terrainType": "rocky"
    },
    {
      "type": "hill",
      "centerX": -62,
      "centerZ": 54,
      "radius": 7.5,
      "height": 1,
      "terrainType": "loose_dirt"
    },
    {
      "type": "hill",
      "centerX": -66,
      "centerZ": 10,
      "radius": 7.5,
      "height": 2,
      "terrainType": null
    },
    {
      "type": "polyWall",
      "points": [
        {
          "x": 26,
          "z": -62.5,
          "radius": 9
        },
        {
          "x": 59,
          "z": -62.5,
          "radius": 6
        },
        {
          "x": 59,
          "z": -41,
          "radius": 3.5
        },
        {
          "x": 19.5,
          "z": -38,
          "radius": 4.5
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
          "x": 6,
          "z": -80,
          "radius": 0
        },
        {
          "x": 80,
          "z": -80,
          "radius": 19.5
        },
        {
          "x": 80,
          "z": -19,
          "radius": 7
        },
        {
          "x": 22,
          "z": -14,
          "radius": 4.5
        },
        {
          "x": 22,
          "z": -1,
          "radius": 0
        }
      ],
      "height": 2,
      "thickness": 0.5,
      "friction": 0.1,
      "closed": false
    },
    {
      "type": "hill",
      "centerX": 62,
      "centerZ": -55,
      "radius": 10,
      "height": 5,
      "terrainType": "loose_dirt"
    },
    {
      "type": "polyWall",
      "points": [
        {
          "x": 29,
          "z": 43,
          "radius": 25.5
        },
        {
          "x": 55,
          "z": 43,
          "radius": 3.5
        },
        {
          "x": 55,
          "z": 28,
          "radius": 3.5
        },
        {
          "x": 20,
          "z": 28,
          "radius": 6
        }
      ],
      "height": 2,
      "thickness": 0.5,
      "friction": 0.1,
      "closed": true
    },
    {
      "type": "trackSign",
      "x": -44.46881934721701,
      "z": -47.97496157963009,
      "name": "Blaster",
      "rotation": 0,
      "contentType": "text",
      "brandImage": "energizer-racing.png",
      "background": "black",
      "scale": 1.45,
      "heightOffset": 0.8,
      "width": 11.5
    },
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
        1.5,
        1.5,
        1.5,
        2,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1.5,
        2,
        2,
        2,
        1.5,
        0,
        0,
        0,
        0,
        1.5,
        1.5,
        -0.5,
        -0.5,
        -0.5,
        0,
        0,
        0,
        0.5,
        1.5,
        1.5,
        -1.5,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1.5,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        -1,
        0,
        1.5,
        0,
        0,
        0,
        0,
        0,
        0,
        -0.5,
        0,
        2,
        0,
        0,
        0,
        0,
        0,
        1,
        1.5,
        2,
        2.5
      ],
      "smoothing": 1
    },
    {
      "type": "hill",
      "centerX": 59,
      "centerZ": 29.5,
      "radius": 10,
      "height": 5,
      "terrainType": null
    },
    {
      "type": "polyWall",
      "points": [
        {
          "x": 22,
          "z": 0,
          "radius": 0
        },
        {
          "x": 78,
          "z": -1,
          "radius": 10
        },
        {
          "x": 78,
          "z": 78,
          "radius": 10
        },
        {
          "x": 13,
          "z": 78,
          "radius": 0
        }
      ],
      "height": 2,
      "thickness": 0.5,
      "friction": 0.1,
      "closed": false
    },
    {
      "type": "bannerString",
      "x": 4.5,
      "z": -10.5,
      "heading": 0,
      "width": 38,
      "poleHeight": 12
    },
    {
      "type": "bannerString",
      "x": 6,
      "z": 30.499999999999986,
      "heading": 0,
      "width": 36,
      "poleHeight": 12
    },
    {
      "type": "bannerString",
      "x": 4.5,
      "z": -1,
      "heading": 0.05000000000000002,
      "width": 38,
      "poleHeight": 12
    },
    {
      "type": "bannerString",
      "x": 5.5,
      "z": -39.5,
      "heading": 0.05000000000000002,
      "width": 35,
      "poleHeight": 12
    },
    {
      "type": "squareHill",
      "centerX": 51.39884431444753,
      "centerZ": -71.79765207624321,
      "width": 10,
      "depth": 13,
      "transition": 5,
      "terrainType": null,
      "heightAtMin": 4.5,
      "heightAtMax": 0
    },
    {
      "type": "squareHill",
      "centerX": 37.5,
      "centerZ": -28.275213105162592,
      "width": 0.5,
      "depth": 20,
      "height": 1,
      "transition": 0.5,
      "terrainType": null
    },
    {
      "type": "squareHill",
      "centerX": 43.5,
      "centerZ": -28.775213105162592,
      "width": 0.5,
      "depth": 20,
      "height": 1,
      "transition": 0.5,
      "terrainType": null
    },
    {
      "type": "squareHill",
      "centerX": 49.5,
      "centerZ": -29.275213105162592,
      "width": 0.5,
      "depth": 20,
      "height": 1,
      "transition": 0.5,
      "terrainType": null
    },
    {
      "type": "squareHill",
      "centerX": 55.5,
      "centerZ": -29.775213105162592,
      "width": 0.5,
      "depth": 20,
      "height": 1,
      "transition": 0.5,
      "terrainType": null
    },
    {
      "type": "actionZone",
      "zoneType": "pickupSpawn",
      "x": 66.15961143831977,
      "z": -31.784275921761918,
      "shape": "circle",
      "width": 30,
      "depth": 30,
      "rotation": 0,
      "radius": 15
    },
    {
      "type": "actionZone",
      "zoneType": "pickupSpawn",
      "x": 11.422310922206421,
      "z": -65.07493938763164,
      "shape": "circle",
      "width": 30,
      "depth": 30,
      "rotation": 0,
      "radius": 15
    },
    {
      "type": "actionZone",
      "zoneType": "pickupSpawn",
      "x": 5.247145218335469,
      "z": -4.941218018314615,
      "shape": "circle",
      "width": 30,
      "depth": 30,
      "rotation": 0,
      "radius": 15
    },
    {
      "type": "actionZone",
      "zoneType": "pickupSpawn",
      "x": 61,
      "z": 60.224786894837415,
      "shape": "circle",
      "width": 30,
      "depth": 30,
      "rotation": 0,
      "radius": 15
    },
    {
      "type": "actionZone",
      "zoneType": "pickupSpawn",
      "x": -51.965357457095074,
      "z": 64.654545190146,
      "shape": "circle",
      "width": 30,
      "depth": 30,
      "rotation": 0,
      "radius": 15
    },
    {
      "type": "checkpoint",
      "centerX": -27,
      "centerZ": -24.71008524206502,
      "heading": 1.5707963267948966,
      "width": 22.5,
      "checkpointNumber": 7
    },
    {
      "type": "checkpoint",
      "centerX": 69.5,
      "centerZ": -44.21008524206502,
      "heading": -3.141592653589793,
      "width": 19,
      "checkpointNumber": 1
    },
    {
      "type": "checkpoint",
      "centerX": 5,
      "centerZ": -39.21008524206502,
      "heading": 0,
      "width": 24.5,
      "checkpointNumber": 2
    },
    {
      "type": "checkpoint",
      "centerX": 5,
      "centerZ": 30.78991475793498,
      "heading": 0,
      "width": 24.5,
      "checkpointNumber": 3
    },
    {
      "type": "checkpoint",
      "centerX": 66.5,
      "centerZ": 42.78991475793498,
      "heading": 3.0415926535897935,
      "width": 21,
      "checkpointNumber": 4
    },
    {
      "type": "checkpoint",
      "centerX": -26.551762769779426,
      "centerZ": 16.830640246663023,
      "heading": -1.5707963267948966,
      "width": 24,
      "checkpointNumber": 5
    },
    {
      "type": "checkpoint",
      "centerX": -70,
      "centerZ": 27.78991475793498,
      "heading": -3.141592653589793,
      "width": 16,
      "checkpointNumber": 6
    },
    {
      "type": "hill",
      "centerX": 66.5,
      "centerZ": 8.78991475793498,
      "radius": 10,
      "height": -1.5,
      "terrainType": "loose_dirt"
    },
    {
      "type": "terrain",
      "shape": "circle",
      "centerX": -68,
      "centerZ": -21.77521310516257,
      "terrainType": "loose_dirt",
      "width": 17.5,
      "depth": 25.5,
      "rotation": 0
    },
    {
      "type": "hill",
      "centerX": 40,
      "centerZ": 20,
      "radius": 7,
      "height": 3.5,
      "terrainType": "loose_dirt"
    },
    {
      "type": "aiPath",
      "points": [
        {
          "x": 17.5,
          "z": -25.5
        },
        {
          "x": 54.620000000000005,
          "z": -26.42
        },
        {
          "x": 74.58,
          "z": -45.28
        },
        {
          "x": 70.66694603139035,
          "z": -65.77217419875012
        },
        {
          "x": 23.17,
          "z": -75.21
        },
        {
          "x": 2.16,
          "z": -56.18000000000001
        },
        {
          "x": 8.1,
          "z": 47.82
        },
        {
          "x": 34.17246673685683,
          "z": 69.45041159871934
        },
        {
          "x": 67.46400558252881,
          "z": 56.60727275035522
        },
        {
          "x": 68.05254005515008,
          "z": 15.368424636611753
        },
        {
          "x": 29.740000000000002,
          "z": 7.379999999999999
        },
        {
          "x": -16.76,
          "z": 15.91
        },
        {
          "x": -43.14,
          "z": 28.68
        },
        {
          "x": -46.4813927878533,
          "z": 53.3905453986742
        },
        {
          "x": -62.68952819962322,
          "z": 64.04846179762635
        },
        {
          "x": -69.28565190225956,
          "z": 9.347228239182837
        },
        {
          "x": -58.033031843742684,
          "z": -19.474706125290577
        },
        {
          "x": -32.37,
          "z": -25.64
        }
      ]
    },
    {
      "type": "actionZone",
      "zoneType": "outOfBounds",
      "shape": "polygon",
      "x": -25.14216263235842,
      "z": 54.24906990645593,
      "radius": 15,
      "points": [
        {
          "x": -36,
          "z": 36.72478689483741
        },
        {
          "x": -32.5,
          "z": 31.724786894837408
        },
        {
          "x": -27.777066687948338,
          "z": 30.427147095029294
        },
        {
          "x": -14.625,
          "z": 30.474786894837408
        },
        {
          "x": -12.605779978850462,
          "z": 70.91610296195753
        },
        {
          "x": -0.25,
          "z": 80
        },
        {
          "x": -41.380338681542575,
          "z": 80
        },
        {
          "x": -35.99911571052599,
          "z": 73.72494851014835
        }
      ]
    },
    {
      "type": "actionZone",
      "zoneType": "outOfBounds",
      "shape": "polygon",
      "x": 39.75198603796025,
      "z": 35.04938288287776,
      "radius": 15,
      "points": [
        {
          "x": 25.34219662049307,
          "z": 28.31038895772479
        },
        {
          "x": 49.18763922716023,
          "z": 28.57270037728406
        },
        {
          "x": 54.20480245602873,
          "z": 29.69894096510671
        },
        {
          "x": 54.78125,
          "z": 39.7626065525813
        },
        {
          "x": 51.375,
          "z": 42.6376065525813
        },
        {
          "x": 32.25,
          "z": 41.1376065525813
        },
        {
          "x": 28.25,
          "z": 39.1376065525813
        },
        {
          "x": 22.625,
          "z": 31.137606552581303
        }
      ]
    },
    {
      "type": "actionZone",
      "zoneType": "outOfBounds",
      "shape": "polygon",
      "x": -41.7323105793979,
      "z": -52.48320133232245,
      "radius": 15,
      "points": [
        {
          "x": -7,
          "z": -72.8623934474187
        },
        {
          "x": -14,
          "z": -55.3623934474187
        },
        {
          "x": -14.75,
          "z": -38.36239344741869
        },
        {
          "x": -63.75,
          "z": -37.36239344741869
        },
        {
          "x": -73.49910963518316,
          "z": -33.02641369359912
        },
        {
          "x": -80,
          "z": -22.889623175305672
        },
        {
          "x": -80,
          "z": -80
        },
        {
          "x": -0.859375,
          "z": -80
        }
      ]
    },
    {
      "type": "actionZone",
      "zoneType": "outOfBounds",
      "shape": "polygon",
      "x": 53.73624270916257,
      "z": -8.680326731950462,
      "radius": 15,
      "points": [
        {
          "x": 25.15625,
          "z": -13.700106552581282
        },
        {
          "x": 74,
          "z": -18.200106552581282
        },
        {
          "x": 80,
          "z": -23.200106552581282
        },
        {
          "x": 79.83771942879875,
          "z": 8.34991657981902
        },
        {
          "x": 71.47222953533917,
          "z": -1.611670940565837
        },
        {
          "x": 22.90625,
          "z": -1.200106552581282
        },
        {
          "x": 22.78125,
          "z": -11.200106552581282
        }
      ]
    },
    {
      "type": "actionZone",
      "zoneType": "outOfBounds",
      "shape": "polygon",
      "x": 41.2265625,
      "z": -51.012606552581275,
      "radius": 15,
      "points": [
        {
          "x": 58.59375,
          "z": -57.700106552581275
        },
        {
          "x": 58.59375,
          "z": -44.700106552581275
        },
        {
          "x": 56.34375,
          "z": -41.700106552581275
        },
        {
          "x": 21.843749999999996,
          "z": -39.700106552581275
        },
        {
          "x": 21.718749999999996,
          "z": -43.700106552581275
        },
        {
          "x": 25.1875,
          "z": -56.825106552581275
        },
        {
          "x": 32.65625,
          "z": -61.950106552581275
        },
        {
          "x": 54.875,
          "z": -61.825106552581275
        }
      ]
    },
    {
      "type": "obstacle",
      "obstacleType": "softWall",
      "x": -43.246869964287406,
      "z": 7.33659018826426,
      "angle": -0.8726646259971649,
      "scale": 1,
      "weight": 80,
      "color": "yellow"
    },
    {
      "type": "obstacle",
      "obstacleType": "softWall",
      "x": -47.740452480725196,
      "z": 13.093491004302379,
      "angle": -0.48869219055841195,
      "scale": 1,
      "weight": 80,
      "color": "yellow"
    },
    {
      "type": "trackSign",
      "x": -30.234775978853428,
      "z": -5.412317020316561,
      "name": "Track Name",
      "rotation": 0.06981317007977318,
      "contentType": "brand",
      "brandImage": "rally-master.png",
      "background": "black",
      "scale": 1.85,
      "heightOffset": 2,
      "width": 10
    },
    {
      "type": "trackSign",
      "x": -24.234775978853428,
      "z": 46.587682979683436,
      "name": "Track Name",
      "rotation": -0.9773843811168246,
      "contentType": "brand",
      "brandImage": "rocket-gasoline.png",
      "background": "black",
      "scale": 1.85,
      "heightOffset": 2,
      "width": 10
    },
    {
      "type": "trackSign",
      "x": 40.26522402114657,
      "z": -7.412317020316561,
      "name": "Track Name",
      "rotation": -0.05235987755982989,
      "contentType": "brand",
      "brandImage": "roll-fast.png",
      "background": "white",
      "scale": 1.85,
      "heightOffset": 2,
      "width": 10
    },
    {
      "type": "trackSign",
      "x": 39.76522402114657,
      "z": 35.087682979683436,
      "name": "Track Name",
      "rotation": 0.10471975511965978,
      "contentType": "brand",
      "brandImage": "roll-fast.png",
      "background": "white",
      "scale": 1.85,
      "heightOffset": 0.2,
      "width": 10
    },
    {
      "type": "trackSign",
      "x": 39.76522402114657,
      "z": -49.412317020316564,
      "name": "Track Name",
      "rotation": 0.06981317007977318,
      "contentType": "brand",
      "brandImage": "rally-master.png",
      "background": "black",
      "scale": 1.85,
      "heightOffset": 0,
      "width": 10
    },
    {
      "type": "obstacle",
      "obstacleType": "softWall",
      "x": 70.27684040680528,
      "z": -22.315329461298745,
      "angle": -1.1868238913561442,
      "scale": 1,
      "weight": 80,
      "color": "yellow"
    },
    {
      "type": "obstacle",
      "obstacleType": "softWall",
      "x": 76.45561180355598,
      "z": -27.304083068537807,
      "angle": -0.7155849933176749,
      "scale": 1,
      "weight": 80,
      "color": "yellow"
    },
    {
      "type": "obstacle",
      "obstacleType": "softWall",
      "x": 74.30761248749064,
      "z": 68.06866723962987,
      "angle": -0.7155849933176749,
      "scale": 1,
      "weight": 80,
      "color": "yellow"
    },
    {
      "type": "obstacle",
      "obstacleType": "softWall",
      "x": 68.18555642714674,
      "z": 73.59778744229124,
      "angle": -1.0297442586766543,
      "scale": 1,
      "weight": 80,
      "color": "yellow"
    },
    {
      "type": "flag",
      "x": -50.08015910406968,
      "z": -11.514575467675012,
      "color": "red"
    },
    {
      "type": "flag",
      "x": 60.91984089593032,
      "z": -54.014575467675016,
      "color": "red"
    },
    {
      "type": "flag",
      "x": 56.91984089593032,
      "z": 28.985424532324984,
      "color": "blue"
    }
  ]
}`;export{n as default};
