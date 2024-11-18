document.addEventListener('DOMContentLoaded', () => {
    const title = document.querySelector('h1');
    title.style.background = 'linear-gradient(90deg, #6a5acd, #48b1f3)';
    title.style.webkitBackgroundClip = 'text';
    title.style.webkitTextFillColor = 'transparent';
});


function showModal(projectId) {
    document.getElementById(`${projectId}-modal`).style.display = 'block';
}

function closeModal(projectId) {
    document.getElementById(`${projectId}-modal`).style.display = 'none';
}

//Close modal when clicking outside
window.onclick = function(event) {
    const modals = document.getElementsByClassName('modal');
    for (let modal of modals) {
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    }
};
