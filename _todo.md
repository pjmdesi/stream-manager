# To-Do

## Improvement ideas

1. Send to converter tasks for auto-rules
2. Add more info to onboarding step 1.5 to tell user about the reasons to not use dump mode including the tools the app provides to help with organization in folder-per-stream mode
3. Add "How to use" page to settings with tips and best practices for using the app.
4. Add ability for app to detect if livestream is currently live and show it in the app.
5. Arrow buttons in the edit metadata modal to easily navigate between streams without having to close the modal and click on another stream to edit it. Not sure where they should go, maybe outside the actual modal container in the overlay space on either side?
6. Maybe a music folder manager as well? To control and add info to the music that's played during streams through OBS.
7. Add a more visual distinction between upcoming streams and past streams.
8. Maybe an alternative view for the streams page, such as a grid view instead of a table view.
9. Implement animations in the UI to improve user experience.
10. Add shorts view & upload functionality. Will need to enhance clipping feature to save shorts more fully. Will need to build a place to manage them. Might need to be a separate shorts page or upgrade the streams page to be able to handle both streams and their related shorts.
11. For the launcher widget, update the button text to be specific: "Launch X Apps", also maybe list the apps in a tooltip on hover.
12. Maybe add a button to a completed conversion task to send the source and output files to my other app ClpChk if it's detected on the user's machine. Since it's a deployable app, I may need to update it to add a registry key or something to indicate its location for other apps to find it. This button would send the current stream item or video file to ClpChk for checking and fixing any issues with the clips before uploading.
13. The man nav sideabar is collapsing too small, it should still show the icons.
14. Add a check to the thumbnail usage from streams. When I thumbnail has been edited, show a mild warning to the user that the thumbnail has been updated but never updated to the streaming platform (YouTube), then they can choose to go to the edit metadata modal to upload the new thumbnail to YouTube. This is because the app will update the thumbnail in the local stream folder.

## Bugs

1. It looks like the app is not updating the "Game title" field on YouTube with the game of the stream item when I click the "Update YouTube Info" button in the edit metadata modal.