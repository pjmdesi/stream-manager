# To-Do

## Improvement ideas

1. Add new Panel to right sidebar in player page:
  a. Mini video file viewer to see all the video files in the same stream item as the opened one (or in the same folder as the dropped-in/browsed video) and easily switch between them. (locked when in clipping mode)
  b. Will be pinned to the bottom of the sidebar below the audio merge panel. WIll show a simple list of the other videos available (if there are any) and display the length in a timecode format (accounting for cloud sync interrupt). When the user clicks on a video in this panel, it will replace the current video in the player. The list item will show a small thumbnail of the video (scaled up on hover, taken somewhere from the middle of the video, again accounting for the cloud sync interrupt), the filename (truncated if necessary), and the length.
  c. Audio merge will stay where it is the same panel, we need to tighten up the height of the elements to make room for the new panel. When Audio merge process is happening, the mini streams viewer will be locked and show a message to the user that they can switch videos once the audio merge is complete or after they cancel the merge.
2. Fix up the styling of the audio merge panel: center align the checkbox element with the content of the button. Convert it to a regular checkbox element matching the others throughout the app (like the ones on the settings page). Make the "Merge audio tracks" button look more like an action button and less like the toggle buttons above. Make the audio format info below the track name more legible.
3. Send to converter tasks for auto-rules
4. Add the ability to zoom and pan in the video player. Max zoom level should be ~600%, min zoom should be 25%. When zoomed enough that the video element exceeds the bounds of the player, the user should be able to middle-click and drag to pan around the video. When the user zooms in or out, it should zoom in towards the current position of the mouse cursor. The pan bounds should be limited to the edges of the video and the center of the video container, no edge of the video should be able to go past the center of the video container, regardless of the zoom level.
5. Add more info to onboarding step 1.5 to tell user about the reasons to not use dump mode including the tools the app provides to help with organization in folder-per-stream mode
6. Add "How to use" page to settings with tips and best practices for using the app.
7. Add ability for app to detect if livestream is currently live and show it in the app.
8. Arrow buttons in the edit metadata modal to easily navigate between streams without having to close the modal and click on another stream to edit it. Not sure where they should go, maybe outside the actual modal container in the overlay space on either side?
9. Maybe a music folder manager as well? To control and add info to the music that's played during streams through OBS.
10. Add a more visual distinction between upcoming streams and past streams.
11. Maybe an alternative view for the streams page, such as a grid view instead of a table view.
12. Maaaaaaaybe a thumbnail creator / editor??? Would that even be possible without reinventing canva / illustrator?
13.  Implement animations in the UI to improve user experience.
14. Add shorts view & upload functionality. Will need to enhance clipping feature to save shorts more fully. Will need to build a place to manage them. Might need to be a separate shorts page or upgrade the streams page to be able to handle both streams and their related shorts.
15. For the launcher widget, update the button text to be specific: "Launch X Apps", also maybe list the apps in a tooltip on hover.
16. Maybe add a button to a completed conversion task to send the source and output files to my other app ClpChk if it's detected on the user's machine. Since it's a deployable app, I may need to update it to add a registry key or something to indicate its location for other apps to find it. This button would send the current stream item or video file to ClpChk for checking and fixing any issues with the clips before uploading.

## Bugs
