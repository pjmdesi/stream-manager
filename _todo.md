# To-Do

## Improvement ideas

1. Send to converter tasks for auto-rules
2. Add more info to onboarding step 1.5 to tell user about the reasons to not use dump mode including the tools the app provides to help with organization in folder-per-stream mode
3. Add "How to use" page to settings with tips and best practices for using the app.
4. Add ability for app to detect if livestream is currently live and show it in the app.
5. Arrow buttons in the edit metadata modal to easily navigate between streams without having to close the modal and click on another stream to edit it. Not sure where they should go, maybe outside the actual modal container in the overlay space on either side?
6. Maybe a music folder manager as well? To control and add info to the music that's played during streams through OBS.
7. Maybe an alternative view for the streams page, such as a grid view instead of a list view.
8. Implement animations in the UI to improve user experience.
9.  Add shorts view & upload functionality. Will need to enhance clipping feature to save shorts more fully. Will need to build a place to manage them. Might need to be a separate shorts page or upgrade the streams page to be able to handle both streams and their related shorts.
10. Maybe add a button to a completed conversion task to send the source and output files to my other app ClpChk if it's detected on the user's machine. Since it's a deployable app, I may need to update it to add a registry key or something to indicate its location for other apps to find it. This button would send the current stream item or video file to ClpChk for checking and fixing any issues with the clips before uploading.
11. Add a check to the thumbnail usage from streams. When I thumbnail has been edited, show a mild warning to the user that the thumbnail has been updated but never updated to the streaming platform (YouTube), then they can choose to go to the edit metadata modal to upload the new thumbnail to YouTube. This is because the app will update the thumbnail in the local stream folder. User should be able to dismiss this message if they don't want to update the thumbnail on YouTube through the app for some reason (maybe they only made a structure change to the thumbnail, and not a visual one).
12. Allow axis constraint when moving objects in the thumbnail editor while the shift key is held, to make it easier to keep objects aligned while moving them around.
13. Attach cropping position to different clip regions so users can change where the crop is for those different regions. This will allow users to have more control over the cropping of their clips, and make it easier to ensure that important parts of the video are not cropped out when creating clips for highlights or shorts.
14. Add more cropping options like square, zooming in with any crop shape, and maybe just allow manual resizing of the crop box instead of just the preset aspect ratios. This will give users more flexibility in how they want to crop their videos for different platforms and purposes.

## Bugs

1. It looks like the app is not updating the "Game title" field on YouTube with the game of the stream item when I click the "Update YouTube Info" button in the edit metadata modal.
2. When I tried to create a new stream item that has the same date as one that is already in the list, the app allowed me to click "Create stream". When I did, it closed the dialog and edited the metadata of the *already existing* stream item. It did not warn me that a stream item already existed (which it should do as soon as the date is selected in the date picker). If the date is the same as an existing stream item, the app should show a warning and not allow the user to create the stream item until they select a different date that does not already have a stream item.