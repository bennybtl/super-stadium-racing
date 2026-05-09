> Here is the Menu Hierarchy

# Base Style for all menus
- The default style for all clickable menu buttons is white italic capital letters with a thick black outline.
- Hover state style for all clickable menu buttons is yellow italic capital letters with a thick black outline. 
- Hover state applies 1.2x scale up

- Each menu screen is rounded box
  - the background should be a tiled version of src/assets/checker-black.png 
  - it responsively scale to contain the content.
  - it should scale up to a 10% margin all around.
  - it should scroll-y if the content is too large
  - it should Never scroll-x

----

# New Components
- TruckSelection.vue — display vehicle list, color list, preview image
- RaceSetup.vue — difficulty/laps/opponent count options, display selection summary
- TruckUpgrades.vue — show current truck stats, available upgrades, purchase/apply UI

----

# ARE YOU SURE POP-UP
"ARE YOU SURE?"
[buttons: CONFIRM, CANCEL]

----

# Start Screen
- Displays the background image from src/assets/title.png
- A single button animates from the bottom of the screen reading "START"

Navigation
- Clicking the START button navigates to the Main Menu

# Main Menu
- Displays the background image from src/assets/title.png
- A vertical menu consisting of these options:
  - PRACTICE
  - SINGLE RACE
  - START SEASON
    - will clear a saved season in localStorage. 
    - In case of saved season, prompt to [ buttons: RESUME SAVED SEASON, START NEW SEASON] 
  - RESUME SEASON
    - available if saved season is in localStorage
  - ------------
  - TRACK EDITOR (#999 grey instead of white)
  - SETTINGS (#999 grey instead of white)

Navigation
- Clicking the PRACTICE button navigates to the PRACTICE screen
- Clicking the SINGLE RACE button navigates to the RACE screen
- Clicking the START SEASON button navigates to the SEASON screen
- Clicking the RESUME SEASON button navigates to the PIT SCREEN with the current saved season state loaded
- Clicking the TRACK EDITOR button navigates to the TRACK EDITOR screen
- Clicking the SETTINGS button navigates to the SETTINGS screen

# PRACTICE
- Display the src/vue/TruckSelection.vue component
- Display the src/vue/TrackSelectionCarousel.vue component
- A horizontal menu consisting of these options:
  - BACK
    - return the MAIN MENU
  - START PRACTICE
    - Launches the games with the selected Truck and Track

## PRACTICE PAUSE
  > Escape while in the practice displays this menu
  - RESUME
  - RESTART
  - EXIT
    - Display "ARE YOU SURE?" pop-up

# SINGLE RACE
- Display the src/vue/TrackSelectionCarousel.vue component
- Display the src/vue/RaceSetup.vue component (need to create)
- A horizontal menu consisting of these options:
  - BACK
    - return the MAIN MENU
  - START RACE
    - Navigates to the PIT SCREEN

## SINGLE RACE PAUSE
  > Escape while in the single race displays this menu
  - RESUME
  - RESTART
  - EXIT
    - Display "ARE YOU SURE?" pop-up

# SEASON
> Season state and progress should be saved to localStorage after each race is completed
> When a season is completed, localStorage is cleared.
  - Display the src/vue/SeasonSetup.vue component
  - A horizontal menu consisting of these options:
    - BACK
      - return to the MAIN MENU
    - START SEASON
      - Navigates to the PIT SCREEN

## SEASON RACE PAUSE
  > Escape while in the practice displays this menu
  - RESUME
  - FORFEIT RACE
    - Display "ARE YOU SURE?" pop-up
    - continues to next race
  - EXIT
    - Display "ARE YOU SURE?" pop-up

# PIT SCREEN
- Display the src/vue/TruckSelection.vue component (need to create)
- Display the src/vue/TruckUpgrades component (need to create)
  - if season: SAVE & EXIT
    - Save state to localStorage
    - Exits to MAIN MENU
  - if season: END SEASON
    - Display "ARE YOU SURE?" pop-up
  - START RACE
  - if not season: EXIT
    - Display "ARE YOU SURE?" pop-up

# TRACK EDITOR
  > Track Edits persist in localStorage
  - Display the src/vue/TrackSelectionCarousel.vue component
  - Click a track to enter the editor

## TRACK EDITOR PAUSE
  > Escape while in the editor displays this menu
  - SAVE TRACK
    - saves the current track to local storage. Doesn't download
  - DOWNLOAD TRACK
    - downloads the track JSON file
  - RESET TRACK
    - Clears all changes and loads the last saved track or bundled version
  - SELECT TRACK
    - Exits the editor and navigates to the TRACK EDITOR menu
  - EXIT
    - Exits the editor and navigats to the MAIN MENU


# SETTINGS MENU
> all settings persist in localStorage
- Displays the background image from src/assets/title.png
- A vertical menu consisting of these options:
  - CONTROLS
  - SOUND
  - DISPLAY
  - MANAGE TRACKS
  - ------------
  - BACK
    - return the MAIN MENU

## SETTINGS MENU > CONTROLS
  - DRIVING
    Display all the current key mappings and allows the user to click one and press a new button to map
  - EDITOR
    Display all the current key mappings and allows the user to click one and press a new button to map
  - --------------
  - RESET TO DEFAULTS
  - BACK
    - return the SETTINGS MENU

## SETTINGS MENU > SOUND
  - Adjust the engine volume
  - Adjust the effects volume
  - Adjust the music volume (no music yet)
  - ------------
  - BACK

## SETTINGS MENU > DISPLAY
  - Adjust the shadow render detail
  - Adjust the lighting complexity (1, 4, or 6 stadium lights)
  - ------------
  - BACK

## SETTINGS MENU > MANAGE TRACKS
  - LOAD TRACKS
    - Upload all tracks JSON files and images in a zip file
    - These should we written to local storage
  - EXPORT TRACKS
    - Download all tracks JSON files and images in a zip file
  - RESET TRACKS
    - Display "ARE YOU SURE?" pop-up
    - Clear local storage so that all the default tracks are loaded
  - ------------
  - BACK

# Track Pack ZIP file stucture
> trackName is the "trackId" of the track in JSON file
tracks/
  trackId.json
  trackId.jpg