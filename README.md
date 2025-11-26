Build your own custom network topology map
# Notes
index.html
<img width="2527" height="1218" alt="index html" src="https://github.com/user-attachments/assets/a6ba412f-bffe-494c-b081-bce053920e18" />
admin.html

## 1 File structure
<img width="2511" height="1222" alt="admin html" src="https://github.com/user-attachments/assets/246432e6-90ce-47be-a8b8-7339caeba225" />

### Add domain

1. [Login Cloudflared](https://dash.cloudflare.com/login)
2. Click `+ Add a domain` and follow instructions


### 2 Create tunnel

1. Click Zero trust -> Networks -> Tunnels
2. Create tunnel -> Docker -> Get the token, its behind --token. Keep it save we are 
going to use it later. 
3. Click next, select domain. Service: Type HTTP. URL: localhost:<port>, we are using port 3000.   


## 1. Install docker Ubuntu
[Setup](https://docs.docker.com/engine/install/ubuntu/)

```
docker logs <Container name>
```
