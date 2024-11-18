document.addEventListener('DOMContentLoaded', () => {
    const title = document.querySelector('h1');
    title.style.background = 'linear-gradient(90deg, #6a5acd, #48b1f3)';
    title.style.webkitBackgroundClip = 'text';
    title.style.webkitTextFillColor = 'transparent';
});

//This is the function for projects page to show the project modal
function showModal(projectId) {
    document.getElementById(`${projectId}-modal`).style.display = 'block';
}

//This is the funciton for projects page to close the project modal
function closeModal(projectId) {
    document.getElementById(`${projectId}-modal`).style.display = 'none';

    // Pause video when closing the modal
    const video = document.querySelector('#video-container video');
    if (video) {
        video.pause();
    }
}

function showVideo() {
    const videoContainer = document.getElementById('video-container');
    videoContainer.style.display = 'block'; // Show the video container
}

window.addEventListener('click', function(event) {
    const modals = document.getElementsByClassName('modal');
    for (let modal of modals) {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    }
});